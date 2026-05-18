import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/payment.repository';
import * as chargeLineRepo from '../../repositories/chargeLine.repository';
import * as invoiceRepo from '../../repositories/invoice.repository';
import * as financeRepo from '../../repositories/finance.repository';
import { runInTransaction } from '../../utils/prisma-tx';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  allocatePayment,
  type AllocationStrategy,
  type PaymentAllocationOutcome,
} from '../../utils/payment-allocation';

import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── List query ───────────────────────────────────────────────────────────────

export interface PaymentListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  invoiceId?: string;
  status?: string;
  paymentMethod?: string;
}

export async function list(query: PaymentListQuery) {
  const { cursor, limit, sort, order, studentAccountId, invoiceId, status, paymentMethod } = query;
  return repo.list(
    { studentAccountId, invoiceId, status, paymentMethod },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('Payment', id);
  return result;
}

export async function create(
  data: Prisma.PaymentUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('Payment', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'payment.created',
    entityType: 'Payment',
    entityId: result.id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      invoiceId: result.invoiceId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      paymentMethod: result.paymentMethod,
      status: result.status,
    },
  });
  return result;
}

/**
 * Financially-significant fields on a Payment record.
 *
 * Once a payment has been allocated (`allocatedAt` is set), changes to
 * these fields would cause the payment record to diverge from the
 * ChargeLine, Invoice, and StudentAccount totals already posted.
 * Callers must reverse the allocation before amending these fields.
 */
const PAYMENT_ALLOCATED_PROTECTED_FIELDS = [
  'amount',
  'invoiceId',
  'transactionDate',
  'paymentMethod',
  'status',
] as const;

export async function update(
  id: string,
  data: Prisma.PaymentUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);

  // Fix 6: Prevent financially-significant changes to an already-allocated
  // payment. Changing amount, invoiceId, transactionDate, paymentMethod, or
  // status after allocation would cause the payment record to diverge from
  // the ChargeLine, Invoice, and StudentAccount totals already posted during
  // allocation. The `reference` field is purely administrative and remains
  // changeable.
  if (previous.allocatedAt != null) {
    const attemptedField = PAYMENT_ALLOCATED_PROTECTED_FIELDS.find(
      (field) => field in data && (data as Record<string, unknown>)[field] !== undefined,
    );
    if (attemptedField) {
      throw new ValidationError(
        `Cannot modify '${attemptedField}' on an allocated payment ` +
        `(allocatedAt: ${previous.allocatedAt.toISOString()}). ` +
        'Reverse the allocation first before amending financially-significant fields.',
      );
    }
  }

  const result = await repo.update(id, data);
  await logAudit('Payment', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'payment.updated',
    entityType: 'Payment',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      invoiceId: result.invoiceId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      status: result.status,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'payment.status_changed',
      entityType: 'Payment',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus: previous.status,
        newStatus: result.status,
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);

  // Fix 7: Prevent deletion of an allocated payment. A payment with
  // `allocatedAt` set has already posted financial effects (ChargeLine
  // status flips, Invoice.paidAmount increments, StudentAccount ledger
  // entries). Deleting such a payment without reversing these effects
  // would leave the finance data in an inconsistent state.
  if (previous.allocatedAt != null) {
    throw new ValidationError(
      'Cannot delete an allocated payment without first reversing its financial impact ' +
      '(the linked ChargeLines, Invoices, and StudentAccount ledger remain settled).',
    );
  }

  await repo.softDelete(id);
  await logAudit('Payment', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'payment.deleted',
    entityType: 'Payment',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: previous.studentAccountId,
      invoiceId: previous.invoiceId,
    },
  });
}

// ── Phase 18C — Payment allocation ───────────────────────────────────────────

export interface AllocateForPaymentOptions {
  strategy?: AllocationStrategy;
  persist?: boolean;
  /** Operator override: allocate even when the payment is not in COMPLETED status. */
  force?: boolean;
}

export interface AllocateForPaymentResult extends PaymentAllocationOutcome {
  paymentId: string;
  studentAccountId: string;
  /** True when the persistence layer applied the allocation (ChargeLine flips + invoice/account updates). */
  persisted: boolean;
  /** ChargeLine IDs that were flipped to PAID by this allocation. */
  paidChargeLineIds: string[];
}

/**
 * Allocate a single Payment across the open ChargeLines for its
 * StudentAccount. Pure allocation logic is delegated to
 * `utils/payment-allocation`; this function is the I/O orchestrator.
 *
 * Persist mode (default) opens a single Prisma `$transaction` that:
 *   1. **Atomically claims** the payment for allocation by stamping
 *      `allocatedAt` via `stampAllocatedAtInTx` (Fix 2 / concurrent lock).
 *      For non-force mode: conditional (`WHERE allocatedAt IS NULL`), so
 *      a second concurrent request will get count=0 and abort. For force
 *      mode: unconditional, refreshes the timestamp.
 *   2. Reads open ChargeLines **inside** the transaction (Fix 4 — reduces
 *      the race window for concurrent allocation requests).
 *   3. Marks fully-covered ChargeLines as PAID via `markPaidBulk`, which
 *      carries a `status IN (PENDING, INVOICED)` guard so concurrent runs
 *      cannot double-flip the same row (Fix 4).
 *   4. After `markPaidBulk`, reconciles which charge IDs were actually
 *      flipped by re-reading their status when the count falls short of
 *      the planned count (Fix 8). Only actually-flipped charges contribute
 *      to invoice/account updates.
 *   5. Increments `ChargeLine.paidAmount` for ALL processed allocations
 *      (fully-covered AND partial) via `updatePartialPaidAmounts`, which
 *      now uses `updateMany` with a status guard (Fixes 1 and 3). This
 *      ensures `status = PAID` is always accompanied by a consistent
 *      `paidAmount = amount`.
 *   6. Increments `Invoice.paidAmount` per affected invoice and promotes
 *      invoice status to PAID / PARTIALLY_PAID.
 *   7. Updates the StudentAccount ledger:
 *      - **First allocation** (`allocatedAt` was null before this call):
 *        posts the full `paymentAmount` (totalAllocated + leftover) so
 *        the ledger reflects both the settled charges and any credit balance
 *        (Fix 5 — overpayment / pre-payment correctness).
 *      - **Force re-allocation** (`allocatedAt` was already set): posts
 *        only `totalAllocated` because the original payment amount was
 *        already credited on the first allocation.
 *
 * `allocatedAt` is stamped **inside the transaction** (step 1), not after
 * it, so the idempotency guard and the allocation mutations are fully
 * atomic. The pre-transaction check on `allocatedAt` remains as a fast-
 * path for the common case.
 *
 * @throws NotFoundError when the Payment does not exist.
 * @throws ValidationError when the payment is not COMPLETED and
 *         `force: true` is not supplied.
 * @throws ValidationError when the payment has already been allocated
 *         (`allocatedAt` is set) and `force: true` is not supplied.
 * @throws ValidationError when a concurrent request has already claimed
 *         this payment's allocation lock (stampAllocatedAtInTx returns 0).
 */
export async function allocateForPayment(
  paymentId: string,
  options: AllocateForPaymentOptions,
  userId: string,
  req: Request,
): Promise<AllocateForPaymentResult> {
  const payment = await repo.getById(paymentId);
  if (!payment) throw new NotFoundError('Payment', paymentId);

  if (payment.status !== 'COMPLETED' && options.force !== true) {
    throw new ValidationError(
      `Cannot allocate payment ${paymentId}: status is ${payment.status} (expected COMPLETED). Re-run with force: true to allocate anyway.`,
    );
  }

  // Fast-path idempotency guard: refuse re-allocation without force.
  // The authoritative check is the in-transaction conditional stamp (step 1
  // below), which handles concurrent requests. This guard avoids starting a
  // transaction for the common single-caller case.
  if (payment.allocatedAt != null && options.persist !== false && options.force !== true) {
    throw new ValidationError(
      `Payment ${paymentId} has already been allocated (allocatedAt: ${payment.allocatedAt.toISOString()}). Re-run with force: true to allocate against any remaining open charges.`,
    );
  }

  const paymentAmount = toNumber(payment.amount as unknown as DecimalLike);
  const studentAccountId = payment.studentAccountId;

  // Determined before the transaction: is this the first time this payment
  // has been allocated? Used to choose the ledger posting amount (Fix 5).
  const isFirstAllocation = payment.allocatedAt == null;

  let outcome!: PaymentAllocationOutcome;
  let persisted = false;
  const paidChargeLineIds: string[] = [];

  if (options.persist !== false) {
    await runInTransaction(async (tx) => {
      // Step 1: Claim this payment for allocation (Fix 2 — concurrent lock).
      // Non-force: conditional stamp (WHERE allocatedAt IS NULL). If another
      // concurrent transaction already set allocatedAt, count=0 → abort.
      // Force: unconditional stamp, always refreshes the timestamp.
      if (options.force !== true) {
        const stampResult = await repo.stampAllocatedAtInTx(paymentId, tx, true);
        if (stampResult.count === 0) {
          throw new ValidationError(
            `Payment ${paymentId} was claimed by a concurrent allocation request. ` +
            'Re-run with force: true if you intend to apply this payment against newly-created charges.',
          );
        }
      } else {
        await repo.stampAllocatedAtInTx(paymentId, tx, false);
      }

      // Step 2: Read open charges inside the transaction (Fix 4 — reduces
      // the race window between reading charges and mutating them).
      const openCharges = await chargeLineRepo.findOpenForAccount(studentAccountId, tx);
      outcome = allocatePayment({
        paymentAmount,
        openCharges: openCharges.map((c) => ({
          id: c.id,
          invoiceId: c.invoiceId,
          amount: toNumber(c.amount as unknown as DecimalLike),
          // Fix 2/issue 2: pass previously-applied amount so the pure utility
          // computes outstanding = amount − alreadyAllocated correctly.
          alreadyAllocated: toNumber(c.paidAmount as unknown as DecimalLike),
          dueDate: c.dueDate,
          createdAt: c.createdAt,
        })),
        ...(options.strategy ? { strategy: options.strategy } : {}),
      });

      // Step 3: Flip fully-covered charges to PAID (Fix 4 — status guard
      // in markPaidBulk prevents double-flipping under concurrent force runs).
      const plannedFullyCoveredIds = outcome.allocations
        .filter((a) => a.fullyCovered && a.amount > 0)
        .map((a) => a.chargeLineId);

      // Fix 8: Reconcile actually-flipped IDs. In non-force mode, the
      // stampAllocatedAtInTx lock above ensures no concurrent transaction
      // ran, so every planned ID will have been flipped. In force mode,
      // two concurrent force-allocations could race; we re-read the charge
      // statuses when markPaidBulk flips fewer rows than planned so that
      // invoice/account updates only cover charges we actually settled.
      let actuallyFlippedIds = new Set<string>(plannedFullyCoveredIds);
      if (plannedFullyCoveredIds.length > 0) {
        const bulkResult = await chargeLineRepo.markPaidBulk(plannedFullyCoveredIds, userId, tx);
        if (bulkResult.count < plannedFullyCoveredIds.length) {
          const statusRows = await chargeLineRepo.findStatusByIdsInTx(
            plannedFullyCoveredIds,
            tx,
          );
          actuallyFlippedIds = new Set(
            statusRows.filter((s) => s.status === 'PAID').map((s) => s.id),
          );
        }
        paidChargeLineIds.push(...Array.from(actuallyFlippedIds));
      }

      // Step 4: Increment paidAmount for all processed allocations.
      // Fix 1: includes fully-covered charges (not just partials) so that
      // ChargeLine.paidAmount is consistent with status = PAID.
      // Only charges that were actually flipped (actuallyFlippedIds) get the
      // increment for the fully-covered subset; all partial charges get it.
      // Fix 3: updatePartialPaidAmounts now uses updateMany with a status
      // guard so concurrent PAID flips produce count:0 instead of throwing.
      const paidAmountUpdates = outcome.allocations
        .filter((a) => a.amount > 0)
        .filter((a) => !a.fullyCovered || actuallyFlippedIds.has(a.chargeLineId))
        .map((a) => ({ id: a.chargeLineId, incrementBy: a.amount }));
      if (paidAmountUpdates.length > 0) {
        await chargeLineRepo.updatePartialPaidAmounts(paidAmountUpdates, userId, tx);
      }

      // Step 5: Compute actual invoice impact (Fix 8 — excludes allocations
      // for charges that were not actually flipped by this transaction).
      const actualInvoiceImpact: { invoiceId: string; amount: number }[] = [];
      {
        const map = new Map<string, number>();
        for (const a of outcome.allocations) {
          if (!a.invoiceId || a.amount <= 0) continue;
          // Skip fully-covered charges that were not actually flipped by us.
          if (a.fullyCovered && !actuallyFlippedIds.has(a.chargeLineId)) continue;
          const prev = map.get(a.invoiceId) ?? 0;
          map.set(a.invoiceId, prev + a.amount);
        }
        for (const [invoiceId, amount] of map.entries()) {
          actualInvoiceImpact.push({ invoiceId, amount });
        }
      }

      // Step 6: Increment invoice.paidAmount per affected invoice.
      for (const impact of actualInvoiceImpact) {
        // eslint-disable-next-line no-await-in-loop
        await invoiceRepo.incrementPaidAmountInTx(impact.invoiceId, impact.amount, tx);
      }

      // Step 7: Promote invoice statuses based on post-increment values.
      for (const impact of actualInvoiceImpact) {
        // eslint-disable-next-line no-await-in-loop
        const invoiceRow = await invoiceRepo.findStatusProjectionInTx(impact.invoiceId, tx);
        if (!invoiceRow) continue;
        const total = toNumber(invoiceRow.totalAmount as unknown as DecimalLike);
        const paid = toNumber(invoiceRow.paidAmount as unknown as DecimalLike);
        const newStatus: 'PAID' | 'PARTIALLY_PAID' | null =
          paid >= total ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : null;
        if (newStatus && newStatus !== invoiceRow.status) {
          // eslint-disable-next-line no-await-in-loop
          await invoiceRepo.updateStatusInTx(impact.invoiceId, newStatus, tx);
        }
      }

      // Step 8: Update the StudentAccount ledger (Fix 5).
      // First allocation: post the full paymentAmount (totalAllocated + leftover)
      // so the ledger reflects both settled charges and any unapplied credit balance.
      // Force re-allocation: post only totalAllocated (the original paymentAmount
      // was already credited on the first allocation — avoid double-crediting).
      const ledgerAmount = isFirstAllocation ? paymentAmount : outcome.totalAllocated;
      if (ledgerAmount > 0) {
        await financeRepo.recordPaymentLedgerEntryInTx(studentAccountId, ledgerAmount, tx);
      }
    });

    // allocatedAt was stamped inside the transaction (step 1).
    persisted = true;
  } else {
    // Preview mode — compute allocation without touching the database.
    const openCharges = await chargeLineRepo.findOpenForAccount(studentAccountId);
    outcome = allocatePayment({
      paymentAmount,
      openCharges: openCharges.map((c) => ({
        id: c.id,
        invoiceId: c.invoiceId,
        amount: toNumber(c.amount as unknown as DecimalLike),
        alreadyAllocated: toNumber(c.paidAmount as unknown as DecimalLike),
        dueDate: c.dueDate,
        createdAt: c.createdAt,
      })),
      ...(options.strategy ? { strategy: options.strategy } : {}),
    });
  }

  await logAudit(
    'Payment',
    paymentId,
    'UPDATE',
    userId,
    null,
    {
      strategy: outcome.strategy,
      paymentAmount: outcome.paymentAmount,
      totalAllocated: outcome.totalAllocated,
      leftover: outcome.leftover,
      paidChargeLineIds,
      persisted,
      force: options.force === true,
    },
    req,
  );
  emitEvent({
    event: 'payment.allocated',
    entityType: 'Payment',
    entityId: paymentId,
    actorId: userId,
    data: {
      studentAccountId,
      strategy: outcome.strategy,
      paymentAmount: outcome.paymentAmount,
      totalAllocated: outcome.totalAllocated,
      leftover: outcome.leftover,
      fullyAllocated: outcome.fullyAllocated,
      paidChargeLineIds,
      invoiceImpact: outcome.invoiceImpact,
      persisted,
      ...(options.force === true ? { force: true } : {}),
    },
  });

  return {
    ...outcome,
    paymentId,
    studentAccountId,
    persisted,
    paidChargeLineIds,
  };
}
