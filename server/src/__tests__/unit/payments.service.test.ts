import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../utils/prisma', () => {
  const tx = {
    invoice: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    studentAccount: {
      update: vi.fn().mockResolvedValue({}),
    },
    chargeLine: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    default: {
      $transaction: vi.fn(async (cb: any) => cb(tx)),
      __tx: tx,
    },
  };
});
vi.mock('../../repositories/payment.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
  softDelete: vi.fn(),
  // Fix 2: stampAllocatedAtInTx is called inside the transaction to claim the
  // payment as a distributed lock (conditional=true) or refresh the timestamp
  // (conditional=false for force mode).
  stampAllocatedAtInTx: vi.fn().mockResolvedValue({ count: 1 }),
}));
vi.mock('../../repositories/chargeLine.repository', () => ({
  findOpenForAccount: vi.fn(),
  markPaidBulk: vi.fn().mockResolvedValue({ count: 99 }), // sentinel: > any planned set in normal tests
  updatePartialPaidAmounts: vi.fn().mockResolvedValue(undefined),
  // Fix 8: findStatusByIdsInTx is used to reconcile which charges were
  // actually flipped when markPaidBulk.count < planned (concurrent force run).
  findStatusByIdsInTx: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as paymentsService from '../../api/payments/payments.service';
import * as repo from '../../repositories/payment.repository';
import * as chargeLineRepo from '../../repositories/chargeLine.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import prismaModule from '../../utils/prisma';

const mockedRepo = vi.mocked(repo);
const mockedChargeLineRepo = vi.mocked(chargeLineRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);
const mockedTx = (prismaModule as unknown as { __tx: any }).__tx;

// Sentinel value for markPaidBulk mock: deliberately larger than any planned
// fully-covered set in normal happy-path tests so the reconciliation branch
// (findStatusByIdsInTx) is skipped. Tests that verify reconciliation behaviour
// override this with a smaller count.
const MOCK_BULK_SUCCESS_COUNT = 99;
function fakeCharge(overrides: Partial<{
  id: string;
  invoiceId: string | null;
  amount: number;
  paidAmount: number;
  currency: string;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
}> = {}) {
  return {
    id: 'c1',
    invoiceId: 'inv-A',
    amount: 500,
    paidAmount: 0,
    currency: 'GBP',
    status: 'PENDING',
    dueDate: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const fakePayment = {
  id: 'pay-1',
  studentAccountId: 'acct-1',
  invoiceId: null,
  amount: 1000,
  paymentMethod: 'BANK_TRANSFER',
  reference: 'TXN-001',
  transactionDate: new Date('2025-09-01'),
  status: 'COMPLETED',
  allocatedAt: null,
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('paymentsService.allocateForPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.getById.mockResolvedValue(fakePayment as any);
    mockedRepo.update.mockResolvedValue({ ...fakePayment, allocatedAt: new Date() } as any);
    // Default: stampAllocatedAtInTx succeeds (conditional lock acquired).
    mockedRepo.stampAllocatedAtInTx.mockResolvedValue({ count: 1 } as any);
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);
    // Default: markPaidBulk returns a count larger than any planned fully-covered
    // set in normal tests so reconciliation (findStatusByIdsInTx) is skipped.
    mockedChargeLineRepo.markPaidBulk.mockResolvedValue({ count: MOCK_BULK_SUCCESS_COUNT } as any);
    mockedChargeLineRepo.findStatusByIdsInTx.mockResolvedValue([] as any);
    // Reset transaction-side mocks each test:
    mockedTx.invoice.update.mockClear();
    mockedTx.invoice.findUnique.mockResolvedValue(null);
    mockedTx.studentAccount.update.mockClear();
    mockedTx.chargeLine.updateMany.mockClear();
    mockedTx.chargeLine.update.mockClear();
  });

  it('throws NotFoundError when the payment does not exist', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(
      paymentsService.allocateForPayment('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the payment is not COMPLETED and force is false', async () => {
    mockedRepo.getById.mockResolvedValue({ ...fakePayment, status: 'PENDING' } as any);
    await expect(
      paymentsService.allocateForPayment('pay-1', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('allocates a non-COMPLETED payment when force:true is supplied', async () => {
    mockedRepo.getById.mockResolvedValue({ ...fakePayment, status: 'PENDING' } as any);
    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { force: true, persist: false },
      'user-1',
      fakeReq,
    );
    expect(result.persisted).toBe(false);
    expect(findEvent('payment.allocated')).toBeDefined();
  });

  // ── Issue 1 fix: allocatedAt idempotency guard ────────────────────────────

  it('throws ValidationError when payment already has allocatedAt set and force is not supplied', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...fakePayment,
      allocatedAt: new Date('2025-09-01'),
    } as any);
    await expect(
      paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('proceeds when allocatedAt is set and force:true is supplied', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...fakePayment,
      allocatedAt: new Date('2025-09-01'),
    } as any);
    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { force: true, persist: false },
      'user-1',
      fakeReq,
    );
    expect(result.persisted).toBe(false);
    expect(findEvent('payment.allocated')).toBeDefined();
  });

  it('stamps allocatedAt via stampAllocatedAtInTx inside the transaction', async () => {
    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);
    // Fix 2: stamp now happens inside the transaction (distributed lock).
    expect(mockedRepo.stampAllocatedAtInTx).toHaveBeenCalledWith(
      'pay-1',
      expect.any(Object), // tx
      true,               // conditional (non-force)
    );
  });

  // ── Fix 2: concurrent lock (stampAllocatedAtInTx returns count=0) ────────────

  it('throws ValidationError when stampAllocatedAtInTx returns count=0 (concurrent allocation)', async () => {
    // Simulate a concurrent request having already claimed the payment lock.
    mockedRepo.stampAllocatedAtInTx.mockResolvedValueOnce({ count: 0 } as any);
    await expect(
      paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('uses unconditional stamp (conditional=false) in force mode', async () => {
    mockedRepo.getById.mockResolvedValue({ ...fakePayment, allocatedAt: new Date('2025-09-01') } as any);
    await paymentsService.allocateForPayment('pay-1', { force: true, persist: true }, 'user-1', fakeReq);
    expect(mockedRepo.stampAllocatedAtInTx).toHaveBeenCalledWith(
      'pay-1',
      expect.any(Object),
      false, // unconditional in force mode
    );
  });

  // ── Fix 5: ledger posts full paymentAmount on first allocation ────────────

  it('persist mode decrements StudentAccount.balance by the full paymentAmount on first allocation', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 200, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A', totalAmount: 200, paidAmount: 200, status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    // First allocation: ledgerAmount = paymentAmount = 1000 (totalAllocated 200 + leftover 800).
    expect(mockedTx.studentAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1' },
        data: expect.objectContaining({
          balance: { decrement: 1000 },
          totalCredits: { increment: 1000 },
        }),
      }),
    );
  });

  it('persist mode posts the full paymentAmount to the ledger even when there are no open charges (credit balance)', async () => {
    // No open charges → totalAllocated = 0, leftover = 1000.
    // First allocation: ledgerAmount = paymentAmount = 1000 (overpayment / pre-payment).
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    expect(mockedTx.studentAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1' },
        data: expect.objectContaining({
          balance: { decrement: 1000 },
          totalCredits: { increment: 1000 },
        }),
      }),
    );
  });

  it('force re-allocation posts only totalAllocated to the ledger (paymentAmount already credited on first run)', async () => {
    // Simulate a force re-run (allocatedAt already set from first allocation).
    mockedRepo.getById.mockResolvedValue({ ...fakePayment, allocatedAt: new Date('2025-09-01') } as any);
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 200, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A', totalAmount: 200, paidAmount: 200, status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { force: true, persist: true }, 'user-1', fakeReq);

    // Force re-run: ledgerAmount = totalAllocated = 200 (avoid double-crediting).
    expect(mockedTx.studentAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1' },
        data: expect.objectContaining({
          balance: { decrement: 200 },
          totalCredits: { increment: 200 },
        }),
      }),
    );
  });

  it('force re-allocation skips ledger entirely when totalAllocated is zero', async () => {
    // Force re-run, no open charges → totalAllocated = 0 → skip ledger.
    mockedRepo.getById.mockResolvedValue({ ...fakePayment, allocatedAt: new Date('2025-09-01') } as any);
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);

    await paymentsService.allocateForPayment('pay-1', { force: true, persist: true }, 'user-1', fakeReq);

    expect(mockedTx.studentAccount.update).not.toHaveBeenCalled();
  });

  // ── Issue 2 fix: partial paidAmount tracking ──────────────────────────────

  it('reads open charges with alreadyAllocated from paidAmount to compute correct outstanding', async () => {
    // c1 has amount=1000, paidAmount=600 → outstanding = 400
    // Payment amount=1000, so all 400 outstanding on c1 is covered
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 1000, paidAmount: 600 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A', totalAmount: 1000, paidAmount: 1000, status: 'ISSUED',
    });

    const result = await paymentsService.allocateForPayment(
      'pay-1', { persist: false }, 'user-1', fakeReq,
    );

    // Only 400 outstanding, so totalAllocated should be 400 (not 1000)
    expect(result.totalAllocated).toBe(400);
    expect(result.leftover).toBe(600);
  });

  it('calls updatePartialPaidAmounts for both fully-covered AND partially-covered charges (Fix 1)', async () => {
    // Payment=1000, charge-1=600 (fully covered), charge-2=700 (partial: 400 applied)
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 600, paidAmount: 0 }),
      fakeCharge({ id: 'c2', invoiceId: 'inv-A', amount: 700, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A', totalAmount: 1300, paidAmount: 1000, status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    // c1 is fully covered (status → markPaidBulk) AND gets paidAmount set (Fix 1).
    // c2 is partially covered (→ updatePartialPaidAmounts only).
    expect(mockedChargeLineRepo.markPaidBulk).toHaveBeenCalledWith(
      ['c1'],
      'user-1',
      expect.any(Object),
    );
    expect(mockedChargeLineRepo.updatePartialPaidAmounts).toHaveBeenCalledWith(
      expect.arrayContaining([
        { id: 'c1', incrementBy: 600 },
        { id: 'c2', incrementBy: 400 },
      ]),
      'user-1',
      expect.any(Object),
    );
  });

  it('calls updatePartialPaidAmounts even when all charges are fully covered (Fix 1 — paidAmount must equal amount)', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A', totalAmount: 500, paidAmount: 500, status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    // markPaidBulk flips status; updatePartialPaidAmounts brings paidAmount up to amount.
    expect(mockedChargeLineRepo.updatePartialPaidAmounts).toHaveBeenCalledWith(
      [{ id: 'c1', incrementBy: 500 }],
      'user-1',
      expect.any(Object),
    );
  });

  // ── Issue 4 fix: charge read inside transaction ───────────────────────────

  it('reads open charges inside the transaction (persist mode) not before it', async () => {
    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    // In persist mode, findOpenForAccount is called inside the $transaction callback
    // (which runs via prisma.$transaction → tx), so we verify it was called with
    // two arguments: studentAccountId and the transaction client.
    expect(mockedChargeLineRepo.findOpenForAccount).toHaveBeenCalledWith(
      'acct-1',
      expect.any(Object), // the tx client
    );
  });

  it('reads open charges without a transaction client in preview mode', async () => {
    await paymentsService.allocateForPayment('pay-1', { persist: false }, 'user-1', fakeReq);

    expect(mockedChargeLineRepo.findOpenForAccount).toHaveBeenCalledWith(
      'acct-1',
      // no second argument in preview mode
    );
    const callArgs = mockedChargeLineRepo.findOpenForAccount.mock.calls[0];
    expect(callArgs).toHaveLength(1);
  });

  // ── Existing persist-path tests (updated for review fixes) ────────────────

  it('preview mode (persist:false) does not mutate StudentAccount/Invoice/ChargeLine', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
    ] as any);

    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { persist: false },
      'user-1',
      fakeReq,
    );
    expect(result.persisted).toBe(false);
    expect(result.totalAllocated).toBe(500);
    expect(result.leftover).toBe(500);
    expect(mockedTx.invoice.update).not.toHaveBeenCalled();
    expect(mockedTx.studentAccount.update).not.toHaveBeenCalled();
    expect(mockedTx.chargeLine.updateMany).not.toHaveBeenCalled();
    expect(mockedChargeLineRepo.markPaidBulk).not.toHaveBeenCalled();

    const allocated = findEvent('payment.allocated');
    expect(allocated).toBeDefined();
    expect(allocated?.data).toEqual(expect.objectContaining({
      paymentAmount: 1000,
      totalAllocated: 500,
      leftover: 500,
      persisted: false,
    }));
  });

  it('persist mode flips fully-covered ChargeLines to PAID via markPaidBulk', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
      fakeCharge({ id: 'c2', invoiceId: 'inv-A', amount: 300, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A',
      totalAmount: 800,
      paidAmount: 800,
      status: 'ISSUED',
    });

    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(true);
    expect(result.paidChargeLineIds).toEqual(['c1', 'c2']);
    expect(mockedChargeLineRepo.markPaidBulk).toHaveBeenCalledWith(
      ['c1', 'c2'],
      'user-1',
      expect.any(Object),
    );
  });

  it('persist mode increments Invoice.paidAmount per affected invoice', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
      fakeCharge({ id: 'c2', invoiceId: 'inv-B', amount: 300, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A',
      totalAmount: 500,
      paidAmount: 500,
      status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    // Two invoices touched: inv-A and inv-B (each invoice gets a paidAmount increment + a status check update).
    const incrementCalls = mockedTx.invoice.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.paidAmount?.increment !== undefined,
    );
    expect(incrementCalls).toHaveLength(2);
    expect(incrementCalls.map((c: any[]) => c[0].where.id).sort()).toEqual(['inv-A', 'inv-B']);
  });

  it('persist mode promotes invoice status to PAID when paidAmount >= totalAmount', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A',
      totalAmount: 500,
      paidAmount: 500,
      status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    const statusUpdate = mockedTx.invoice.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'PAID',
    );
    expect(statusUpdate).toBeDefined();
  });

  it('persist mode promotes invoice status to PARTIALLY_PAID when 0 < paidAmount < totalAmount', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 2000, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A',
      totalAmount: 2000,
      paidAmount: 1000,
      status: 'ISSUED',
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    const statusUpdate = mockedTx.invoice.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'PARTIALLY_PAID',
    );
    expect(statusUpdate).toBeDefined();
  });

  it('persist mode does NOT update invoice status when status is already correct', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
    ] as any);
    mockedTx.invoice.findUnique.mockResolvedValue({
      id: 'inv-A',
      totalAmount: 500,
      paidAmount: 500,
      status: 'PAID', // already PAID — no flip
    });

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    const statusUpdates = mockedTx.invoice.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.status !== undefined,
    );
    expect(statusUpdates).toHaveLength(0);
  });

  it('forwards the strategy option to the pure utility', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([
      fakeCharge({ id: 'c1', invoiceId: 'inv-A', amount: 1000, paidAmount: 0 }),
      fakeCharge({ id: 'c2', invoiceId: 'inv-A', amount: 500, paidAmount: 0 }),
    ] as any);

    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { strategy: 'PROPORTIONAL', persist: false },
      'user-1',
      fakeReq,
    );

    expect(result.strategy).toBe('PROPORTIONAL');
    // 1000 payment, 1500 outstanding → c1 gets 666.67, c2 gets 333.33
    const c1Amount = result.allocations.find((a) => a.chargeLineId === 'c1')?.amount;
    expect(c1Amount).toBeCloseTo(666.67, 2);
  });

  it('emits payment.allocated with strategy + structured payload regardless of persist mode', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);

    await paymentsService.allocateForPayment('pay-1', { persist: true }, 'user-1', fakeReq);

    const allocated = findEvent('payment.allocated');
    expect(allocated).toBeDefined();
    expect(allocated?.data).toEqual(expect.objectContaining({
      studentAccountId: 'acct-1',
      strategy: 'FIFO',
      paymentAmount: 1000,
      totalAllocated: 0,
      leftover: 1000,
      fullyAllocated: false,
      persisted: true,
    }));
  });

  it('audit subject is Payment with the full structured outcome', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);

    await paymentsService.allocateForPayment('pay-1', { persist: false }, 'user-1', fakeReq);

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'Payment',
      'pay-1',
      'UPDATE',
      'user-1',
      null,
      expect.objectContaining({
        strategy: 'FIFO',
        paymentAmount: 1000,
        totalAllocated: 0,
        persisted: false,
      }),
      fakeReq,
    );
  });

  it('handles a Decimal-string payment amount (Prisma compat)', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...fakePayment,
      amount: { toString: () => '750.50' },
    } as any);
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([] as any);

    const result = await paymentsService.allocateForPayment(
      'pay-1',
      { persist: false },
      'user-1',
      fakeReq,
    );
    expect(result.paymentAmount).toBe(750.5);
  });
});

describe('paymentsService CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById throws NotFoundError when the payment is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(paymentsService.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('create writes through the repo, audits, and emits payment.created', async () => {
    mockedRepo.create.mockResolvedValue({
      id: 'pay-new',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      paymentMethod: 'CARD',
      status: 'COMPLETED',
    } as any);

    await paymentsService.create({} as any, 'user-1', fakeReq);
    expect(mockedRepo.create).toHaveBeenCalledTimes(1);
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'Payment',
      'pay-new',
      'CREATE',
      'user-1',
      null,
      expect.any(Object),
      fakeReq,
    );
    expect(findEvent('payment.created')).toBeDefined();
  });

  it('update emits payment.status_changed when the status moves', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'PENDING',
      allocatedAt: null,
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
    } as any);

    await paymentsService.update('pay-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment.updated')).toBeDefined();
    const statusChanged = findEvent('payment.status_changed');
    expect(statusChanged).toBeDefined();
    expect(statusChanged?.data).toEqual(
      expect.objectContaining({ previousStatus: 'PENDING', newStatus: 'COMPLETED' }),
    );
  });

  it('update does NOT emit payment.status_changed when status is unchanged', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
      allocatedAt: null,
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
    } as any);

    await paymentsService.update('pay-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment.updated')).toBeDefined();
    expect(findEvent('payment.status_changed')).toBeUndefined();
  });

  // ── Fix 6: update guard on allocated payments ─────────────────────────────

  it('update throws ValidationError when trying to change a financially-significant field on an allocated payment', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
      allocatedAt: new Date('2025-09-01'),
    } as any);

    await expect(
      paymentsService.update('pay-1', { amount: 600 } as any, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
    await expect(
      paymentsService.update('pay-1', { status: 'FAILED' } as any, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
    await expect(
      paymentsService.update('pay-1', { invoiceId: 'inv-B' } as any, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('update allows reference change on an allocated payment (non-financial field)', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
      allocatedAt: new Date('2025-09-01'),
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
      reference: 'REF-CORRECTED',
    } as any);

    // Should not throw — reference is an administrative field only.
    await expect(
      paymentsService.update('pay-1', { reference: 'REF-CORRECTED' } as any, 'user-1', fakeReq),
    ).resolves.toBeDefined();
  });

  // ── Fix 7: remove guard on allocated payments ─────────────────────────────

  it('remove soft-deletes through the repo, audits, and emits payment.deleted', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: 'inv-A',
      amount: 500,
      status: 'COMPLETED',
      allocatedAt: null, // not yet allocated — deletion is allowed
    } as any);

    await paymentsService.remove('pay-1', 'user-1', fakeReq);
    expect(mockedRepo.softDelete).toHaveBeenCalledWith('pay-1');
    expect(findEvent('payment.deleted')).toBeDefined();
  });

  it('remove throws ValidationError when payment has been allocated (allocatedAt set)', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'pay-1',
      studentAccountId: 'acct-1',
      invoiceId: null,
      amount: 500,
      status: 'COMPLETED',
      allocatedAt: new Date('2025-09-01'),
    } as any);

    await expect(paymentsService.remove('pay-1', 'user-1', fakeReq)).rejects.toThrow(ValidationError);
  });
});
