import prisma from '../utils/prisma';
import { toNumber, type DecimalLike } from '../utils/decimal-helpers';
import type {
  NegativeBalanceRow,
  OrphanChargeLineRow,
  DuplicateInvoiceNumberRow,
} from '../utils/ledger-anomaly';

/**
 * Phase 1E — read-only ledger-anomaly detection queries.
 *
 * Each helper returns the raw projection the pure
 * `classifyLedgerAnomalies` utility consumes. There are no mutations
 * here — this repository is a pure read surface used by the anomaly-scan
 * service and its BullMQ cron. Every query accepts a `limit` so a
 * pathological dataset cannot exhaust worker memory; the default is
 * generous but bounded.
 */

const DEFAULT_LIMIT = 1000;

/**
 * StudentAccounts (non-deleted) whose balance is below zero. In this
 * ledger balance = debits − credits, so a negative balance means the
 * institution owes the student or an over-allocation has occurred.
 */
export async function findNegativeBalanceAccounts(
  limit: number = DEFAULT_LIMIT,
): Promise<NegativeBalanceRow[]> {
  const rows = await prisma.studentAccount.findMany({
    where: { deletedAt: null, balance: { lt: 0 } },
    select: { id: true, studentId: true, academicYear: true, balance: true },
    orderBy: { balance: 'asc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    academicYear: r.academicYear,
    balance: toNumber(r.balance as unknown as DecimalLike),
  }));
}

/**
 * Live ChargeLines that are orphaned, either because:
 *   - their invoice has been soft-deleted (invoice.deletedAt is set), or
 *   - their studentAccountId does not match their invoice's
 *     studentAccountId (a cross-account leak).
 *
 * Only charge lines with a non-null invoiceId are considered — an
 * invoiceId of null is a legitimate ad-hoc charge, not an orphan.
 */
export async function findOrphanChargeLines(
  limit: number = DEFAULT_LIMIT,
): Promise<OrphanChargeLineRow[]> {
  const rows = await prisma.chargeLine.findMany({
    where: { deletedAt: null, invoiceId: { not: null } },
    select: {
      id: true,
      studentAccountId: true,
      invoiceId: true,
      amount: true,
      invoice: { select: { id: true, studentAccountId: true, deletedAt: true } },
    },
    take: limit,
  });

  const orphans: OrphanChargeLineRow[] = [];
  for (const r of rows) {
    const amount = toNumber(r.amount as unknown as DecimalLike);
    if (!r.invoice || r.invoice.deletedAt != null) {
      orphans.push({
        id: r.id,
        studentAccountId: r.studentAccountId,
        invoiceId: r.invoiceId,
        amount,
        reason: 'INVOICE_SOFT_DELETED',
      });
    } else if (r.invoice.studentAccountId !== r.studentAccountId) {
      orphans.push({
        id: r.id,
        studentAccountId: r.studentAccountId,
        invoiceId: r.invoiceId,
        amount,
        reason: 'ACCOUNT_MISMATCH',
        invoiceStudentAccountId: r.invoice.studentAccountId,
      });
    }
  }
  return orphans;
}

/**
 * Invoice numbers shared by two or more live (non-deleted) invoices. The
 * DB-level @unique constraint on Invoice.invoiceNumber should make this
 * impossible, but the scan surfaces it defensively in case the constraint
 * was ever bypassed (e.g. a raw migration or a restore). Returns each
 * duplicated number with the colliding invoice ids.
 */
export async function findDuplicateInvoiceNumbers(
  limit: number = DEFAULT_LIMIT,
): Promise<DuplicateInvoiceNumberRow[]> {
  const groups = await prisma.invoice.groupBy({
    by: ['invoiceNumber'],
    where: { deletedAt: null },
    _count: { invoiceNumber: true },
    having: { invoiceNumber: { _count: { gt: 1 } } },
    orderBy: { invoiceNumber: 'asc' },
    take: limit,
  });

  const out: DuplicateInvoiceNumberRow[] = [];
  for (const g of groups) {
    const dupes = await prisma.invoice.findMany({
      where: { deletedAt: null, invoiceNumber: g.invoiceNumber },
      select: { id: true },
    });
    out.push({
      invoiceNumber: g.invoiceNumber,
      count: g._count.invoiceNumber,
      invoiceIds: dupes.map((d) => d.id),
    });
  }
  return out;
}
