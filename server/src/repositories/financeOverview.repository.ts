import prisma from '../utils/prisma';
import { toNumber, type DecimalLike } from '../utils/decimal-helpers';

/**
 * Phase 1F — read-only finance overview aggregations.
 *
 * One pre-computed payload for the staff finance dashboard. Every helper
 * runs a bounded Prisma `aggregate` / `groupBy` against the live ledger;
 * none scans full tables on the client. Closes KI-S5-102 (the v4
 * `/staff/finance-overview` 404) by giving the dashboard a single
 * authoritative source of truth instead of stitching paginated lists
 * together on the client.
 *
 * Read-only by design — surfaces data, never mutates. The numbers reflect
 * "now" (the moment of the query); no caching is intentional so an
 * operator triaging a HIGH-severity ledger anomaly sees the current state
 * rather than a stale snapshot.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-status totals across all non-deleted StudentAccount rows. */
export interface FinanceCollectionTotals {
  totalAccounts: number;
  /** Sum of balance (debits − credits) across non-deleted accounts. */
  outstandingBalance: number;
  /** Sum of totalDebits across non-deleted accounts. */
  totalDebits: number;
  /** Sum of totalCredits across non-deleted accounts. */
  totalCredits: number;
  /** Per-status counts and outstanding-balance subtotals. */
  byStatus: Array<{ status: string; count: number; outstandingBalance: number }>;
}

/**
 * Open invoices bucketed by age relative to `asOf`. Buckets:
 *   - current (due in the future or today)
 *   - 1-30 days overdue
 *   - 31-60 days overdue
 *   - 61-90 days overdue
 *   - 90+ days overdue
 *
 * "Open" means non-deleted, status in DRAFT / ISSUED / PARTIALLY_PAID
 * (i.e. has outstanding balance and is not cancelled / written off).
 */
export interface AgeingBucket {
  bucket: 'CURRENT' | '1_30' | '31_60' | '61_90' | '90_PLUS';
  invoiceCount: number;
  outstanding: number;
}
export interface FinanceAgeing {
  asOf: string;
  buckets: AgeingBucket[];
  /** Sum across all buckets — handy for the dashboard's headline. */
  totalOutstanding: number;
  totalOpenInvoices: number;
}

/** Active sponsor agreements aggregated by sponsorType. */
export interface SponsorLiabilityRow {
  sponsorType: string;
  agreementCount: number;
  amountAgreed: number;
  amountReceived: number;
  /** amountAgreed − amountReceived. */
  liability: number;
}
export interface FinanceSponsorLiability {
  totalAgreements: number;
  totalAgreed: number;
  totalReceived: number;
  totalLiability: number;
  byType: SponsorLiabilityRow[];
}

/** Bursary fund spend snapshot. */
export interface BursaryFundRow {
  fundId: string;
  fundName: string;
  fundType: string;
  academicYear: string;
  totalBudget: number;
  allocated: number;
  remaining: number;
  /** `allocated / totalBudget`, 0..1. NaN-safe (0 when totalBudget is 0). */
  utilisation: number;
}
export interface FinanceBursarySpend {
  totalFunds: number;
  totalBudget: number;
  totalAllocated: number;
  totalRemaining: number;
  funds: BursaryFundRow[];
}

/** Single-shot overview payload for the dashboard. */
export interface FinanceOverview {
  collection: FinanceCollectionTotals;
  ageing: FinanceAgeing;
  sponsorLiability: FinanceSponsorLiability;
  bursarySpend: FinanceBursarySpend;
  generatedAt: string;
}

// ── Collection totals ────────────────────────────────────────────────────────

export async function getCollectionTotals(): Promise<FinanceCollectionTotals> {
  const where = { deletedAt: null };

  const [totals, perStatus] = await Promise.all([
    prisma.studentAccount.aggregate({
      where,
      _count: { _all: true },
      _sum: { balance: true, totalDebits: true, totalCredits: true },
    }),
    prisma.studentAccount.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { balance: true },
      orderBy: { status: 'asc' },
    }),
  ]);

  return {
    totalAccounts: totals._count._all,
    outstandingBalance: toNumber(totals._sum.balance as unknown as DecimalLike),
    totalDebits: toNumber(totals._sum.totalDebits as unknown as DecimalLike),
    totalCredits: toNumber(totals._sum.totalCredits as unknown as DecimalLike),
    byStatus: perStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      outstandingBalance: toNumber(r._sum.balance as unknown as DecimalLike),
    })),
  };
}

// ── Ageing buckets ───────────────────────────────────────────────────────────

// "Open" = the invoice still has (or may have) outstanding balance:
//   - DRAFT          before issue, but balance accrued
//   - ISSUED         issued, unpaid
//   - PARTIALLY_PAID some payment, balance > 0
//   - OVERDUE        explicitly flagged past dueDate; status orthogonal to
//                    the bucket logic below, which uses dueDate vs asOf
//                    directly so OVERDUE invoices land in the correct
//                    1-30 / 31-60 / 61-90 / 90+ bucket
// PAID / CANCELLED / WRITTEN_OFF deliberately omitted.
const OPEN_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** Boundary days (inclusive lower, exclusive upper) for the buckets. */
const AGEING_BOUNDARIES: Array<{ bucket: AgeingBucket['bucket']; minDays: number; maxDays: number | null }> = [
  { bucket: 'CURRENT', minDays: Number.NEGATIVE_INFINITY, maxDays: 1 },
  { bucket: '1_30',    minDays: 1,  maxDays: 31 },
  { bucket: '31_60',   minDays: 31, maxDays: 61 },
  { bucket: '61_90',   minDays: 61, maxDays: 91 },
  { bucket: '90_PLUS', minDays: 91, maxDays: null },
];

export async function getAgeing(asOf: Date = new Date()): Promise<FinanceAgeing> {
  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: OPEN_INVOICE_STATUSES as unknown as string[] as any },
    },
    select: { id: true, dueDate: true, totalAmount: true, paidAmount: true },
  });

  const bucketTotals = new Map<AgeingBucket['bucket'], { count: number; outstanding: number }>();
  for (const b of AGEING_BOUNDARIES) {
    bucketTotals.set(b.bucket, { count: 0, outstanding: 0 });
  }

  let totalOutstanding = 0;
  let totalOpenInvoices = 0;
  const asOfMs = asOf.getTime();

  for (const inv of invoices) {
    const total = toNumber(inv.totalAmount as unknown as DecimalLike);
    const paid = toNumber(inv.paidAmount as unknown as DecimalLike);
    const outstanding = Math.max(0, total - paid);
    if (outstanding <= 0) continue;

    const ageDays = Math.floor((asOfMs - inv.dueDate.getTime()) / DAY_MS);
    const boundary =
      AGEING_BOUNDARIES.find(
        (b) =>
          ageDays >= b.minDays &&
          (b.maxDays === null || ageDays < b.maxDays),
      ) ?? AGEING_BOUNDARIES[0];

    const t = bucketTotals.get(boundary.bucket)!;
    t.count += 1;
    t.outstanding += outstanding;
    totalOutstanding += outstanding;
    totalOpenInvoices += 1;
  }

  return {
    asOf: asOf.toISOString(),
    buckets: AGEING_BOUNDARIES.map((b) => ({
      bucket: b.bucket,
      invoiceCount: bucketTotals.get(b.bucket)!.count,
      outstanding: Math.round(bucketTotals.get(b.bucket)!.outstanding * 100) / 100,
    })),
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    totalOpenInvoices,
  };
}

// ── Sponsor liability ────────────────────────────────────────────────────────

export async function getSponsorLiability(): Promise<FinanceSponsorLiability> {
  const byType = await prisma.sponsorAgreement.groupBy({
    by: ['sponsorType'],
    where: { status: 'active' },
    _count: { _all: true },
    _sum: { amountAgreed: true, amountReceived: true },
    orderBy: { sponsorType: 'asc' },
  });

  let totalAgreements = 0;
  let totalAgreed = 0;
  let totalReceived = 0;

  const rows: SponsorLiabilityRow[] = byType.map((r) => {
    const agreed = toNumber(r._sum.amountAgreed as unknown as DecimalLike);
    const received = toNumber(r._sum.amountReceived as unknown as DecimalLike);
    totalAgreements += r._count._all;
    totalAgreed += agreed;
    totalReceived += received;
    return {
      sponsorType: r.sponsorType,
      agreementCount: r._count._all,
      amountAgreed: agreed,
      amountReceived: received,
      liability: Math.round((agreed - received) * 100) / 100,
    };
  });

  return {
    totalAgreements,
    totalAgreed: Math.round(totalAgreed * 100) / 100,
    totalReceived: Math.round(totalReceived * 100) / 100,
    totalLiability: Math.round((totalAgreed - totalReceived) * 100) / 100,
    byType: rows,
  };
}

// ── Bursary spend ────────────────────────────────────────────────────────────

export async function getBursarySpend(): Promise<FinanceBursarySpend> {
  const funds = await prisma.bursaryFund.findMany({
    select: {
      id: true,
      fundName: true,
      fundType: true,
      academicYear: true,
      totalBudget: true,
      allocated: true,
      remaining: true,
    },
    orderBy: [{ academicYear: 'desc' }, { fundName: 'asc' }],
  });

  let totalBudget = 0;
  let totalAllocated = 0;
  let totalRemaining = 0;

  const rows: BursaryFundRow[] = funds.map((f) => {
    const budget = toNumber(f.totalBudget as unknown as DecimalLike);
    const allocated = toNumber(f.allocated as unknown as DecimalLike);
    const remaining = toNumber(f.remaining as unknown as DecimalLike);
    totalBudget += budget;
    totalAllocated += allocated;
    totalRemaining += remaining;
    return {
      fundId: f.id,
      fundName: f.fundName,
      fundType: f.fundType,
      academicYear: f.academicYear,
      totalBudget: budget,
      allocated,
      remaining,
      utilisation: budget > 0 ? Math.round((allocated / budget) * 10000) / 10000 : 0,
    };
  });

  return {
    totalFunds: funds.length,
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalAllocated: Math.round(totalAllocated * 100) / 100,
    totalRemaining: Math.round(totalRemaining * 100) / 100,
    funds: rows,
  };
}

// ── Composite overview ───────────────────────────────────────────────────────

export async function getOverview(asOf: Date = new Date()): Promise<FinanceOverview> {
  const [collection, ageing, sponsorLiability, bursarySpend] = await Promise.all([
    getCollectionTotals(),
    getAgeing(asOf),
    getSponsorLiability(),
    getBursarySpend(),
  ]);
  return {
    collection,
    ageing,
    sponsorLiability,
    bursarySpend,
    generatedAt: asOf.toISOString(),
  };
}
