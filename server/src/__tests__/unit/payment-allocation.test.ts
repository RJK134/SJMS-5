import { describe, it, expect } from 'vitest';
import {
  allocatePayment,
  type OpenChargeInput,
} from '../../utils/payment-allocation';

const charge = (
  id: string,
  amount: number,
  overrides: Partial<OpenChargeInput> = {},
): OpenChargeInput => ({
  id,
  invoiceId: `inv-${id}`,
  amount,
  ...overrides,
});

describe('allocatePayment — FIFO strategy (default)', () => {
  it('returns no allocations when there are no open charges (full leftover)', () => {
    const result = allocatePayment({ paymentAmount: 1000, openCharges: [] });
    expect(result.allocations).toEqual([]);
    expect(result.totalAllocated).toBe(0);
    expect(result.leftover).toBe(1000);
    expect(result.fullyAllocated).toBe(false);
    expect(result.notes.some((n) => n.includes('No open charges'))).toBe(true);
  });

  it('returns zero allocations when payment amount is zero', () => {
    const result = allocatePayment({
      paymentAmount: 0,
      openCharges: [charge('c1', 500)],
    });
    expect(result.totalAllocated).toBe(0);
    expect(result.leftover).toBe(0);
    expect(result.allocations[0].amount).toBe(0);
    expect(result.notes.some((n) => n.includes('zero'))).toBe(true);
  });

  it('treats negative payment amounts as zero (no negative billing)', () => {
    const result = allocatePayment({
      paymentAmount: -100,
      openCharges: [charge('c1', 500)],
    });
    expect(result.paymentAmount).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });

  it('fully covers a single charge when payment exactly matches outstanding', () => {
    const result = allocatePayment({
      paymentAmount: 500,
      openCharges: [charge('c1', 500)],
    });
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].amount).toBe(500);
    expect(result.allocations[0].fullyCovered).toBe(true);
    expect(result.leftover).toBe(0);
    expect(result.fullyAllocated).toBe(true);
  });

  it('partially covers a single charge when payment is less than outstanding', () => {
    const result = allocatePayment({
      paymentAmount: 200,
      openCharges: [charge('c1', 500)],
    });
    expect(result.allocations[0].amount).toBe(200);
    expect(result.allocations[0].fullyCovered).toBe(false);
    expect(result.leftover).toBe(0);
    expect(result.fullyAllocated).toBe(true);
  });

  it('records leftover when payment exceeds outstanding', () => {
    const result = allocatePayment({
      paymentAmount: 1000,
      openCharges: [charge('c1', 500)],
    });
    expect(result.allocations[0].amount).toBe(500);
    expect(result.leftover).toBe(500);
    expect(result.fullyAllocated).toBe(false);
    expect(result.notes.some((n) => n.includes('Overpayment'))).toBe(true);
  });

  it('walks charges in due-date order (earliest first), then created-date as tiebreak', () => {
    const result = allocatePayment({
      paymentAmount: 700,
      openCharges: [
        charge('cZ', 300, { dueDate: new Date('2025-12-01'), createdAt: new Date('2025-09-01') }),
        charge('cA', 300, { dueDate: new Date('2025-10-01'), createdAt: new Date('2025-09-15') }),
        charge('cB', 300, { dueDate: new Date('2025-11-01'), createdAt: new Date('2025-09-10') }),
      ],
    });
    expect(result.allocations.map((a) => a.chargeLineId)).toEqual(['cA', 'cB', 'cZ']);
    expect(result.allocations[0].fullyCovered).toBe(true); // 300/300 of cA
    expect(result.allocations[1].fullyCovered).toBe(true); // 300/300 of cB
    expect(result.allocations[2].fullyCovered).toBe(false); // 100/300 of cZ
    expect(result.allocations[2].amount).toBe(100);
    expect(result.totalAllocated).toBe(700);
    expect(result.leftover).toBe(0);
  });

  it('places charges with no dueDate after charges that have one', () => {
    const result = allocatePayment({
      paymentAmount: 500,
      openCharges: [
        charge('cNoDue', 200),
        charge('cDue', 300, { dueDate: new Date('2025-10-01') }),
      ],
    });
    expect(result.allocations.map((a) => a.chargeLineId)).toEqual(['cDue', 'cNoDue']);
    expect(result.allocations[0].amount).toBe(300);
    expect(result.allocations[1].amount).toBe(200);
  });

  it('respects already-allocated amounts on a partially-paid charge', () => {
    const result = allocatePayment({
      paymentAmount: 200,
      openCharges: [charge('c1', 500, { alreadyAllocated: 350 })], // outstanding = 150
    });
    expect(result.allocations[0].outstandingBefore).toBe(150);
    expect(result.allocations[0].amount).toBe(150);
    expect(result.allocations[0].fullyCovered).toBe(true);
    expect(result.leftover).toBe(50);
  });

  it('aggregates invoiceImpact by invoiceId', () => {
    const result = allocatePayment({
      paymentAmount: 500,
      openCharges: [
        charge('c1', 200, { invoiceId: 'inv-A' }),
        charge('c2', 300, { invoiceId: 'inv-A' }),
      ],
    });
    expect(result.invoiceImpact).toEqual([{ invoiceId: 'inv-A', amount: 500 }]);
  });

  it('keeps invoiceId null entries out of invoiceImpact (ad-hoc charges)', () => {
    const result = allocatePayment({
      paymentAmount: 500,
      openCharges: [
        charge('cAdHoc', 200, { invoiceId: null }),
        charge('cInv', 300, { invoiceId: 'inv-A' }),
      ],
    });
    const ids = result.invoiceImpact.map((i) => i.invoiceId);
    expect(ids).toEqual(['inv-A']);
    expect(result.invoiceImpact[0].amount).toBe(300);
    // The ad-hoc charge still received its allocation:
    expect(result.allocations.find((a) => a.chargeLineId === 'cAdHoc')?.amount).toBe(200);
  });

  it('skips zero-outstanding charges silently', () => {
    const result = allocatePayment({
      paymentAmount: 500,
      openCharges: [
        charge('c1', 500, { alreadyAllocated: 500 }), // fully paid already
        charge('c2', 300),
      ],
    });
    expect(result.totalAllocated).toBe(300);
    expect(result.allocations.find((a) => a.chargeLineId === 'c2')?.amount).toBe(300);
    expect(result.leftover).toBe(200);
  });

  it('rounds allocations to 2 decimal places', () => {
    const result = allocatePayment({
      paymentAmount: 100.555,
      openCharges: [charge('c1', 200)],
    });
    expect(result.allocations[0].amount).toBeCloseTo(100.56, 2);
  });
});

describe('allocatePayment — PROPORTIONAL strategy', () => {
  it('distributes a payment proportionally across open charges', () => {
    const result = allocatePayment({
      strategy: 'PROPORTIONAL',
      paymentAmount: 600,
      openCharges: [
        charge('c1', 1000),
        charge('c2', 500),
      ],
    });
    expect(result.strategy).toBe('PROPORTIONAL');
    // Total outstanding = 1500; pool = min(600, 1500) = 600
    // c1 share = 1000/1500 * 600 = 400; c2 share = 500/1500 * 600 = 200
    expect(result.allocations.find((a) => a.chargeLineId === 'c1')?.amount).toBe(400);
    expect(result.allocations.find((a) => a.chargeLineId === 'c2')?.amount).toBe(200);
    expect(result.totalAllocated).toBe(600);
    expect(result.leftover).toBe(0);
  });

  it('caps the proportional pool at total outstanding (no over-allocation)', () => {
    const result = allocatePayment({
      strategy: 'PROPORTIONAL',
      paymentAmount: 5000,
      openCharges: [charge('c1', 1000), charge('c2', 500)],
    });
    expect(result.totalAllocated).toBe(1500);
    expect(result.leftover).toBe(3500);
  });

  it('absorbs rounding drift onto the last allocation so sum equals pool', () => {
    const result = allocatePayment({
      strategy: 'PROPORTIONAL',
      paymentAmount: 100,
      openCharges: [
        charge('c1', 333),
        charge('c2', 333),
        charge('c3', 334),
      ],
    });
    expect(result.totalAllocated).toBe(100);
    const sum = result.allocations.reduce((s, a) => s + a.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it('returns zero allocations when no charges are open', () => {
    const result = allocatePayment({
      strategy: 'PROPORTIONAL',
      paymentAmount: 1000,
      openCharges: [],
    });
    expect(result.allocations).toEqual([]);
    expect(result.leftover).toBe(1000);
  });
});

describe('allocatePayment — invariants', () => {
  it('always satisfies totalAllocated + leftover === paymentAmount', () => {
    const cases = [
      { paymentAmount: 500, openCharges: [charge('c1', 500)] },
      { paymentAmount: 1000, openCharges: [charge('c1', 500)] },
      { paymentAmount: 250, openCharges: [charge('c1', 100), charge('c2', 100), charge('c3', 100)] },
      { paymentAmount: 350, openCharges: [charge('c1', 100, { alreadyAllocated: 50 }), charge('c2', 200)] },
    ];
    for (const c of cases) {
      const result = allocatePayment(c);
      expect(Math.round((result.totalAllocated + result.leftover) * 100) / 100).toBe(result.paymentAmount);
    }
  });

  it('always satisfies 0 <= amount <= outstandingBefore for every allocation', () => {
    const result = allocatePayment({
      paymentAmount: 1500,
      openCharges: [charge('c1', 500), charge('c2', 600), charge('c3', 700)],
    });
    for (const a of result.allocations) {
      expect(a.amount).toBeGreaterThanOrEqual(0);
      expect(a.amount).toBeLessThanOrEqual(a.outstandingBefore);
    }
  });

  it('marks fullyCovered === (amount >= outstandingBefore && outstandingBefore > 0)', () => {
    const result = allocatePayment({
      paymentAmount: 700,
      openCharges: [charge('c1', 300), charge('c2', 300), charge('c3', 300)],
    });
    expect(result.allocations[0].fullyCovered).toBe(true);
    expect(result.allocations[1].fullyCovered).toBe(true);
    expect(result.allocations[2].fullyCovered).toBe(false);
    // A zero-outstanding charge is silently skipped (no allocation row).
    const zeroResult = allocatePayment({
      paymentAmount: 100,
      openCharges: [charge('c0', 100, { alreadyAllocated: 100 })],
    });
    expect(zeroResult.allocations).toEqual([]);
    expect(zeroResult.leftover).toBe(100);
  });

  it('is deterministic for FIFO with identical input', () => {
    const input = {
      paymentAmount: 700,
      openCharges: [
        charge('cA', 300, { dueDate: new Date('2025-10-01') }),
        charge('cB', 300, { dueDate: new Date('2025-11-01') }),
        charge('cZ', 300, { dueDate: new Date('2025-12-01') }),
      ],
    };
    const a = allocatePayment(input);
    const b = allocatePayment(input);
    expect(a).toEqual(b);
  });
});
