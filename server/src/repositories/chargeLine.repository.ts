import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Phase 18C — ChargeLine repository.
 *
 * Read-mostly repository for the ChargeLine model. Writes go through
 * the parent flows: invoices.repository.createWithLines for batch
 * creation (18B), and the payments service for status flips after
 * allocation (18C). Direct CRUD on ChargeLine is intentionally not
 * exposed — a charge always belongs to an invoice and the invoice
 * is the system-of-record entity for the operator surface.
 */

export interface OpenChargeProjection {
  id: string;
  invoiceId: string | null;
  amount: Prisma.Decimal;
  /** 
   * Cumulative amount already applied to this charge line by prior
   * payment-allocation runs. The allocation pipeline passes this as
   * `alreadyAllocated` into the pure utility so that
   * `outstanding = amount − paidAmount` is computed correctly on
   * every run. Incremented (never set) by `updatePartialPaidAmounts`.
   */
  paidAmount: Prisma.Decimal;
  currency: string;
  status: 'PENDING' | 'INVOICED' | 'PAID' | 'CREDITED' | 'WRITTEN_OFF';
  dueDate: Date | null;
  createdAt: Date;
}

/**
 * The set of ChargeLine statuses that represent an open (unpaid) charge.
 *
 * Centralised here and reused by `findOpenForAccount`, `markPaidBulk`, and
 * `updatePartialPaidAmounts` so that a future status extension (e.g.
 * adding OVERDUE to the set) is a single-file change.
 */
export const OPEN_CHARGE_STATUSES = ['PENDING', 'INVOICED'] as const;

/**
 * Find every non-deleted, open (status PENDING / INVOICED) ChargeLine
 * for a StudentAccount. Returned projection is intentionally small —
 * the payment allocation pipeline only needs id, invoiceId, amount,
 * paidAmount, status, dueDate, and createdAt to drive FIFO ordering
 * and the post-allocation status flip.
 *
 * **Cancelled-invoice exclusion**: charge lines whose parent invoice
 * carries `status: CANCELLED` are excluded (in addition to the
 * soft-delete filter). This prevents cancelled-invoice charges from
 * being re-opened via the allocation pipeline.
 *
 * Lines without an invoice (`invoiceId: null`) are still considered
 * open and allocatable — they represent ad-hoc charges (LATE_FEE,
 * LIBRARY_FINE, etc.) created via the legacy `finance.repository.
 * createCharge` primitive before they have been rolled into an
 * invoice.
 *
 * An optional `tx` transaction client may be supplied so the read
 * runs inside the caller's open Prisma `$transaction`, reducing the
 * race window for concurrent allocation requests.
 */
export async function findOpenForAccount(
  studentAccountId: string,
  tx?: Prisma.TransactionClient,
): Promise<OpenChargeProjection[]> {
  const client = tx ?? prisma;
  const rows = await client.chargeLine.findMany({
    where: {
      studentAccountId,
      deletedAt: null,
      status: { in: [...OPEN_CHARGE_STATUSES] },
      OR: [
        { invoiceId: null },
        // Issue 3 fix: also exclude charge lines whose parent invoice has been
        // cancelled (previously only soft-deleted invoices were filtered out).
        { invoice: { deletedAt: null, status: { not: 'CANCELLED' } } },
      ],
    },
    select: {
      id: true,
      invoiceId: true,
      amount: true,
      paidAmount: true,
      currency: true,
      status: true,
      dueDate: true,
      createdAt: true,
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });

  return rows as OpenChargeProjection[];
}

export async function getById(id: string) {
  return prisma.chargeLine.findFirst({
    where: { id, deletedAt: null },
    include: { invoice: true },
  });
}

/**
 * Mark a set of ChargeLines as PAID in bulk.
 *
 * Used by the payment-allocation pipeline after a payment has been
 * applied so each fully-covered charge transitions PENDING/INVOICED
 * → PAID atomically. The caller is responsible for sequencing this
 * inside the same Prisma `$transaction` as the StudentAccount and
 * Invoice updates.
 *
 * **Optimistic-concurrency guard (Issue 4 fix)**: the WHERE clause
 * includes `status: { in: [...OPEN_CHARGE_STATUSES] }` so that if two
 * concurrent allocation transactions both attempt to flip the same
 * charge, only the first to commit will match rows. The second
 * transaction's `updateMany` will return `count: 0` for rows already
 * flipped to PAID, preventing double-processing.
 */
export async function markPaidBulk(
  ids: ReadonlyArray<string>,
  userId: string,
  tx: Prisma.TransactionClient,
) {
  if (ids.length === 0) return { count: 0 };
  return tx.chargeLine.updateMany({
    where: {
      id: { in: [...ids] },
      // Only flip rows that are still open — prevents double-processing
      // in concurrent allocation requests.
      status: { in: [...OPEN_CHARGE_STATUSES] },
    },
    data: {
      status: 'PAID',
      updatedBy: userId,
    },
  });
}

/**
 * Increment `paidAmount` on a set of partially- or fully-covered ChargeLines.
 *
 * Used by the payment-allocation pipeline after a payment has been applied
 * to a charge.  For fully-covered charges the status has already been flipped
 * to PAID by `markPaidBulk`; this function brings `paidAmount` up to the line
 * amount so `ChargeLine.paidAmount` is always consistent with `status`.
 * For partially-covered charges the charge remains PENDING / INVOICED and
 * `paidAmount` accumulates across multiple allocation runs.
 *
 * Uses `updateMany` (not `update`) so that charges concurrently flipped to
 * PAID or CREDITED by another transaction simply receive a `count: 0` result
 * rather than throwing P2025.  The `status` guard prevents incrementing a
 * charge whose status has already moved beyond PENDING/INVOICED.
 *
 * Called inside the same `$transaction` as `markPaidBulk`.
 */
export async function updatePartialPaidAmounts(
  updates: ReadonlyArray<{ id: string; incrementBy: number }>,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (updates.length === 0) return;
  await Promise.all(
    updates.map((u) =>
      tx.chargeLine.updateMany({
        where: {
          id: u.id,
          // Fix 3: guard against incrementing a charge that has been
          // concurrently flipped to PAID/CREDITED. updateMany returns
          // count: 0 instead of throwing when the status has changed.
          status: { in: [...OPEN_CHARGE_STATUSES] },
        },
        data: {
          paidAmount: { increment: u.incrementBy },
          updatedBy: userId,
        },
      }),
    ),
  );
}

/**
 * Read the current `status` for a specific set of ChargeLines within the
 * caller's transaction.  Used by the allocation pipeline to reconcile which
 * of the planned fully-covered charges were actually flipped by `markPaidBulk`
 * vs already settled by a concurrent transaction.
 */
export async function findStatusByIdsInTx(
  ids: ReadonlyArray<string>,
  tx: Prisma.TransactionClient,
): Promise<Array<{ id: string; status: string }>> {
  if (ids.length === 0) return [];
  const rows = await tx.chargeLine.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, status: true },
  });
  return rows as Array<{ id: string; status: string }>;
}
