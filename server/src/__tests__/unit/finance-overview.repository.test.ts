/**
 * Phase 1F — finance-overview repository unit tests.
 *
 * The repository runs bounded Prisma `aggregate` / `groupBy` queries to
 * produce the dashboard payload. We mock `utils/prisma` so the tests are
 * pure — every helper is verified against the shape Prisma returns,
 * including Decimal-as-object (`{ toString() }`), Decimal-as-string, and
 * plain-number flavours that flow through `toNumber`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  studentAccountAggregate,
  studentAccountGroupBy,
  invoiceFindMany,
  sponsorAgreementGroupBy,
  bursaryFundFindMany,
} = vi.hoisted(() => ({
  studentAccountAggregate: vi.fn(),
  studentAccountGroupBy: vi.fn(),
  invoiceFindMany: vi.fn(),
  sponsorAgreementGroupBy: vi.fn(),
  bursaryFundFindMany: vi.fn(),
}));

vi.mock('../../utils/prisma', () => ({
  default: {
    studentAccount: { aggregate: studentAccountAggregate, groupBy: studentAccountGroupBy },
    invoice: { findMany: invoiceFindMany },
    sponsorAgreement: { groupBy: sponsorAgreementGroupBy },
    bursaryFund: { findMany: bursaryFundFindMany },
  },
}));

import {
  getCollectionTotals,
  getAgeing,
  getSponsorLiability,
  getBursarySpend,
  getOverview,
} from '../../repositories/financeOverview.repository';

beforeEach(() => {
  vi.clearAllMocks();
  studentAccountAggregate.mockResolvedValue({
    _count: { _all: 0 },
    _sum: { balance: null, totalDebits: null, totalCredits: null },
  });
  studentAccountGroupBy.mockResolvedValue([]);
  invoiceFindMany.mockResolvedValue([]);
  sponsorAgreementGroupBy.mockResolvedValue([]);
  bursaryFundFindMany.mockResolvedValue([]);
});

describe('financeOverview.repository — getCollectionTotals', () => {
  it('sums totals across non-deleted accounts and produces a per-status breakdown', async () => {
    studentAccountAggregate.mockResolvedValue({
      _count: { _all: 5 },
      _sum: { balance: '1234.50', totalDebits: '9999.99', totalCredits: '8765.49' },
    });
    studentAccountGroupBy.mockResolvedValue([
      { status: 'active',   _count: { _all: 4 }, _sum: { balance: '1234.50' } },
      { status: 'archived', _count: { _all: 1 }, _sum: { balance: '0' } },
    ]);

    const r = await getCollectionTotals();
    expect(r.totalAccounts).toBe(5);
    expect(r.outstandingBalance).toBe(1234.50);
    expect(r.totalDebits).toBe(9999.99);
    expect(r.totalCredits).toBe(8765.49);
    expect(r.byStatus).toEqual([
      { status: 'active',   count: 4, outstandingBalance: 1234.50 },
      { status: 'archived', count: 1, outstandingBalance: 0 },
    ]);
    expect(studentAccountAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('null _sum values flow through toNumber as 0', async () => {
    studentAccountAggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { balance: null, totalDebits: null, totalCredits: null },
    });
    const r = await getCollectionTotals();
    expect(r.outstandingBalance).toBe(0);
    expect(r.totalDebits).toBe(0);
    expect(r.totalCredits).toBe(0);
  });
});

describe('financeOverview.repository — getAgeing', () => {
  const asOf = new Date('2026-06-01T12:00:00.000Z');

  it('bucketises invoices by days overdue', async () => {
    invoiceFindMany.mockResolvedValue([
      // Due in the future → CURRENT
      { id: '1', dueDate: new Date('2026-06-15T00:00:00.000Z'), totalAmount: '100',  paidAmount: '0'  },
      // Due today → CURRENT (ageDays = 0)
      { id: '2', dueDate: new Date('2026-06-01T00:00:00.000Z'), totalAmount: '50',   paidAmount: '0'  },
      // 5 days overdue → 1_30
      { id: '3', dueDate: new Date('2026-05-27T00:00:00.000Z'), totalAmount: '200',  paidAmount: '0'  },
      // 31 days overdue → 31_60 (boundary check: 31 is inclusive lower)
      { id: '4', dueDate: new Date('2026-05-01T00:00:00.000Z'), totalAmount: '300',  paidAmount: '0'  },
      // 100 days overdue → 90_PLUS
      { id: '5', dueDate: new Date('2026-02-21T00:00:00.000Z'), totalAmount: '400',  paidAmount: '0'  },
    ]);

    const r = await getAgeing(asOf);
    const byBucket = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(byBucket.CURRENT.invoiceCount).toBe(2);
    expect(byBucket.CURRENT.outstanding).toBe(150);
    expect(byBucket['1_30'].invoiceCount).toBe(1);
    expect(byBucket['1_30'].outstanding).toBe(200);
    expect(byBucket['31_60'].invoiceCount).toBe(1);
    expect(byBucket['31_60'].outstanding).toBe(300);
    expect(byBucket['90_PLUS'].invoiceCount).toBe(1);
    expect(byBucket['90_PLUS'].outstanding).toBe(400);
    // CURRENT 150 + 1_30 200 + 31_60 300 + 90_PLUS 400 = 1050
    expect(r.totalOutstanding).toBe(1050);
    expect(r.totalOpenInvoices).toBe(5);
  });

  it('uses outstanding = max(0, totalAmount − paidAmount) and skips fully-paid invoices', async () => {
    invoiceFindMany.mockResolvedValue([
      { id: '1', dueDate: asOf, totalAmount: '100', paidAmount: '60' },   // outstanding 40
      { id: '2', dueDate: asOf, totalAmount: '50',  paidAmount: '50' },   // fully paid → skipped
      { id: '3', dueDate: asOf, totalAmount: '100', paidAmount: '150' },  // negative → clamped → skipped
    ]);
    const r = await getAgeing(asOf);
    expect(r.totalOutstanding).toBe(40);
    expect(r.totalOpenInvoices).toBe(1);
  });

  it('returns a zeroed buckets array when there are no open invoices', async () => {
    const r = await getAgeing(asOf);
    expect(r.totalOpenInvoices).toBe(0);
    expect(r.totalOutstanding).toBe(0);
    expect(r.buckets.every((b) => b.invoiceCount === 0 && b.outstanding === 0)).toBe(true);
  });

  it('filters on the OPEN_INVOICE_STATUSES set (incl. OVERDUE per BugBot finding on PR #99)', async () => {
    await getAgeing(asOf);
    const where = invoiceFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    // OVERDUE must be included — without it any explicitly-flagged overdue
    // invoice is silently dropped from the dashboard's ageing buckets and
    // headline open-invoice count.
    expect(where.status.in).toEqual(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);
  });

  it('still bucketises an OVERDUE-status invoice by dueDate (status is orthogonal)', async () => {
    invoiceFindMany.mockResolvedValue([
      // Explicitly flagged OVERDUE, 45 days past due → 31_60
      { id: 'ov-1', dueDate: new Date('2026-04-17T00:00:00.000Z'), totalAmount: '500', paidAmount: '0' },
    ]);
    const r = await getAgeing(asOf);
    expect(r.totalOpenInvoices).toBe(1);
    expect(r.totalOutstanding).toBe(500);
    const buckets = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(buckets['31_60'].invoiceCount).toBe(1);
    expect(buckets['31_60'].outstanding).toBe(500);
  });
});

describe('financeOverview.repository — getSponsorLiability', () => {
  it('aggregates active agreements by sponsorType and derives liability', async () => {
    sponsorAgreementGroupBy.mockResolvedValue([
      { sponsorType: 'EMPLOYER', _count: { _all: 3 }, _sum: { amountAgreed: '30000', amountReceived: '10000' } },
      { sponsorType: 'SLC',      _count: { _all: 5 }, _sum: { amountAgreed: '50000', amountReceived: '50000' } },
    ]);
    const r = await getSponsorLiability();
    expect(r.totalAgreements).toBe(8);
    expect(r.totalAgreed).toBe(80000);
    expect(r.totalReceived).toBe(60000);
    expect(r.totalLiability).toBe(20000);
    expect(r.byType[0]).toMatchObject({
      sponsorType: 'EMPLOYER',
      agreementCount: 3,
      amountAgreed: 30000,
      amountReceived: 10000,
      liability: 20000,
    });
    expect(r.byType[1].liability).toBe(0);
  });

  it('only counts active agreements', async () => {
    await getSponsorLiability();
    const where = sponsorAgreementGroupBy.mock.calls[0][0].where;
    expect(where.status).toBe('active');
  });
});

describe('financeOverview.repository — getBursarySpend', () => {
  it('summarises every fund with totals and per-fund utilisation', async () => {
    bursaryFundFindMany.mockResolvedValue([
      { id: 'f1', fundName: 'Hardship 25/26', fundType: 'HARDSHIP',  academicYear: '2025/26', totalBudget: '50000', allocated: '15000', remaining: '35000' },
      { id: 'f2', fundName: 'Access 25/26',   fundType: 'ACCESS',    academicYear: '2025/26', totalBudget: '0',     allocated: '0',     remaining: '0' },
    ]);
    const r = await getBursarySpend();
    expect(r.totalFunds).toBe(2);
    expect(r.totalBudget).toBe(50000);
    expect(r.totalAllocated).toBe(15000);
    expect(r.totalRemaining).toBe(35000);
    expect(r.funds[0].utilisation).toBe(0.3);
    // Zero-budget fund → utilisation 0, not NaN
    expect(r.funds[1].utilisation).toBe(0);
  });
});

describe('financeOverview.repository — getOverview', () => {
  it('combines the four sections in parallel and stamps generatedAt', async () => {
    const asOf = new Date('2026-06-01T12:00:00.000Z');
    const r = await getOverview(asOf);
    expect(r.generatedAt).toBe(asOf.toISOString());
    expect(r).toHaveProperty('collection');
    expect(r).toHaveProperty('ageing');
    expect(r).toHaveProperty('sponsorLiability');
    expect(r).toHaveProperty('bursarySpend');
    // Sanity — the ageing block was passed the requested asOf
    expect(r.ageing.asOf).toBe(asOf.toISOString());
  });

  it('defaults asOf to "now" when not supplied', async () => {
    const before = Date.now();
    const r = await getOverview();
    const after = Date.now();
    const t = new Date(r.generatedAt).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});
