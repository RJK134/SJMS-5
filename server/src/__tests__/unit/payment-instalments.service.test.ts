import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ────────────────
vi.mock('../../utils/prisma', () => ({
  default: { $transaction: vi.fn(async (cb: any) => cb({})) },
}));
vi.mock('../../repositories/paymentInstalment.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../repositories/paymentPlan.repository', () => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../../repositories/payment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../api/payments/payments.service', () => ({
  allocateForPayment: vi.fn(),
}));
vi.mock('../../repositories/chargeLine.repository', () => ({
  findOpenForAccount: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/payment-instalments/payment-instalments.service';
import * as repo from '../../repositories/paymentInstalment.repository';
import * as planRepo from '../../repositories/paymentPlan.repository';
import * as paymentRepo from '../../repositories/payment.repository';
import * as paymentsService from '../../api/payments/payments.service';
import * as chargeLineRepo from '../../repositories/chargeLine.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedPlanRepo = vi.mocked(planRepo);
const mockedPaymentRepo = vi.mocked(paymentRepo);
const mockedPaymentsService = vi.mocked(paymentsService);
const mockedChargeLineRepo = vi.mocked(chargeLineRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

const fakeInstalment = {
  id: 'inst-1',
  paymentPlanId: 'plan-1',
  instalmentNum: 1,
  amount: 300,
  dueDate: new Date('2026-01-01'),
  paidDate: null,
  status: 'PENDING',
};

const fakePlan = {
  id: 'plan-1',
  studentAccountId: 'acct-1',
  planType: 'INSTALMENT_PLAN',
  totalAmount: 900,
  numberOfInstalments: 3,
  instalmentAmount: 300,
  startDate: new Date('2026-01-01'),
  status: 'ACTIVE',
  instalments: [
    { ...fakeInstalment, id: 'inst-1', status: 'PENDING' },
    { id: 'inst-2', paymentPlanId: 'plan-1', instalmentNum: 2, amount: 300, dueDate: new Date('2026-02-01'), paidDate: null, status: 'PENDING' },
    { id: 'inst-3', paymentPlanId: 'plan-1', instalmentNum: 3, amount: 300, dueDate: new Date('2026-03-01'), paidDate: null, status: 'PENDING' },
  ],
};

const fakePayment = {
  id: 'pay-1',
  studentAccountId: 'acct-1',
  invoiceId: null,
  amount: 300,
  paymentMethod: 'BANK_TRANSFER',
  reference: 'TXN-001',
  transactionDate: new Date('2026-01-05'),
  status: 'COMPLETED',
};

describe('paymentInstalmentsService.recordPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.getById.mockResolvedValue(fakeInstalment as any);
    mockedPlanRepo.getById.mockResolvedValue(fakePlan as any);
    mockedPaymentRepo.getById.mockResolvedValue(fakePayment as any);
    // mockReset clears queued mockResolvedValueOnce implementations from prior tests
    // (Vitest stacks once-handlers; clearAllMocks alone does not flush them).
    mockedChargeLineRepo.findOpenForAccount.mockReset();
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValue([{ id: 'c1' }] as any);
    mockedPaymentsService.allocateForPayment.mockReset();
    mockedPaymentsService.allocateForPayment.mockResolvedValue({
      paymentId: 'pay-1',
      studentAccountId: 'acct-1',
      strategy: 'FIFO',
      paymentAmount: 300,
      totalAllocated: 300,
      leftover: 0,
      fullyAllocated: true,
      allocations: [],
      invoiceImpact: [],
      notes: [],
      persisted: true,
      paidChargeLineIds: ['c1'],
    } as any);
    mockedRepo.update.mockResolvedValue({ ...fakeInstalment, status: 'COMPLETED', paidDate: fakePayment.transactionDate } as any);
  });

  it('throws NotFoundError when the instalment does not exist', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(
      service.recordPayment('missing', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the plan does not exist (orphan instalment)', async () => {
    mockedPlanRepo.getById.mockResolvedValue(null);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the payment does not exist', async () => {
    mockedPaymentRepo.getById.mockResolvedValue(null);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'missing' }, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects re-recording against an already-COMPLETED instalment without force', async () => {
    mockedRepo.getById.mockResolvedValue({ ...fakeInstalment, status: 'COMPLETED' } as any);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('rebinds an already-COMPLETED instalment when force:true is supplied', async () => {
    mockedRepo.getById.mockResolvedValue({ ...fakeInstalment, status: 'COMPLETED' } as any);
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', force: true },
      'user-1',
      fakeReq,
    );
    expect(result.instalmentMarkedPaid).toBe(true);
  });

  it('rejects a payment whose StudentAccount differs from the plan without force', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({
      ...fakePayment,
      studentAccountId: 'acct-OTHER',
    } as any);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('binds a cross-account payment when force:true is supplied (sponsor consolidation)', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({
      ...fakePayment,
      studentAccountId: 'acct-OTHER',
    } as any);
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', force: true },
      'user-1',
      fakeReq,
    );
    expect(result.instalmentMarkedPaid).toBe(true);
  });

  it('rejects a payment whose amount is less than the instalment amount without force', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({ ...fakePayment, amount: 250 } as any);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('records partial coverage when force:true is supplied', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({ ...fakePayment, amount: 250 } as any);
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', force: true },
      'user-1',
      fakeReq,
    );
    expect(result.instalmentMarkedPaid).toBe(true);
  });

  it('rejects the COMPLETED flip when there are no open charges on the account (guard fires before allocateForPayment)', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValueOnce([] as any);
    await expect(
      service.recordPayment('inst-1', { paymentId: 'pay-1' }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
    // Guard fires before the allocation — no DB side-effects should have occurred
    expect(mockedPaymentsService.allocateForPayment).not.toHaveBeenCalled();
    expect(mockedRepo.update).not.toHaveBeenCalled();
  });



  it('allows the COMPLETED flip when no open charges exist but force:true is supplied (guard bypassed)', async () => {
    mockedChargeLineRepo.findOpenForAccount.mockResolvedValueOnce([] as any);
    mockedPaymentsService.allocateForPayment.mockResolvedValueOnce({
      paymentId: 'pay-1',
      studentAccountId: 'acct-1',
      strategy: 'FIFO',
      paymentAmount: 300,
      totalAllocated: 0,
      leftover: 300,
      fullyAllocated: false,
      allocations: [],
      invoiceImpact: [],
      notes: [],
      persisted: true,
      paidChargeLineIds: [],
    } as any);
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', force: true },
      'user-1',
      fakeReq,
    );
    expect(result.instalmentMarkedPaid).toBe(true);
  });


  it('drives the 18C allocator with FIFO + persist:true by default', async () => {
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(mockedPaymentsService.allocateForPayment).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ persist: true }),
      'user-1',
      fakeReq,
    );
  });

  it('forwards the strategy override to the 18C allocator', async () => {
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', strategy: 'PROPORTIONAL' },
      'user-1',
      fakeReq,
    );
    expect(mockedPaymentsService.allocateForPayment).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ strategy: 'PROPORTIONAL' }),
      'user-1',
      fakeReq,
    );
  });

  it('forwards force to the 18C allocator so a non-COMPLETED payment can be applied', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({ ...fakePayment, status: 'PENDING' } as any);
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1', force: true },
      'user-1',
      fakeReq,
    );
    expect(mockedPaymentsService.allocateForPayment).toHaveBeenCalledWith(
      'pay-1',
      expect.objectContaining({ force: true }),
      'user-1',
      fakeReq,
    );
  });

  it('flips the instalment to COMPLETED with paidDate=payment.transactionDate', async () => {
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(mockedRepo.update).toHaveBeenCalledWith(
      'inst-1',
      expect.objectContaining({
        status: 'COMPLETED',
        paidDate: fakePayment.transactionDate,
      }),
    );
  });

  it('emits payment_instalment.paid with the structured payload', async () => {
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    const paid = findEvent('payment_instalment.paid');
    expect(paid).toBeDefined();
    expect(paid?.data).toEqual(expect.objectContaining({
      paymentPlanId: 'plan-1',
      paymentId: 'pay-1',
      instalmentNum: 1,
      amount: 300,
      paymentAmount: 300,
      paidChargeLineIds: ['c1'],
    }));
  });

  it('promotes the parent plan to COMPLETED when every instalment is now COMPLETED', async () => {
    // Refreshed plan returned after the instalment flip — all three are now COMPLETED.
    mockedPlanRepo.getById
      .mockResolvedValueOnce(fakePlan as any) // initial load
      .mockResolvedValueOnce({
        ...fakePlan,
        instalments: fakePlan.instalments.map((i) => ({ ...i, status: 'COMPLETED' })),
      } as any); // refresh after the instalment flip
    mockedPlanRepo.update.mockResolvedValue({ ...fakePlan, status: 'COMPLETED' } as any);

    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(result.planMarkedCompleted).toBe(true);
    expect(mockedPlanRepo.update).toHaveBeenCalledWith('plan-1', { status: 'COMPLETED' });

    const planUpdated = findEvent('payment_plan.updated');
    expect(planUpdated).toBeDefined();
    const planStatus = findEvent('payment_plan.status_changed');
    expect(planStatus).toBeDefined();
    expect(planStatus?.data).toEqual(
      expect.objectContaining({ previousStatus: 'ACTIVE', newStatus: 'COMPLETED' }),
    );
  });

  it('does NOT promote the plan when some instalments remain PENDING', async () => {
    mockedPlanRepo.getById
      .mockResolvedValueOnce(fakePlan as any)
      .mockResolvedValueOnce(fakePlan as any); // refresh — still 2 PENDING + 1 we just flipped
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(result.planMarkedCompleted).toBe(false);
    expect(mockedPlanRepo.update).not.toHaveBeenCalledWith('plan-1', { status: 'COMPLETED' });
  });

  it('does NOT promote the plan when it is not ACTIVE (e.g. already DEFAULTED)', async () => {
    const defaultedPlan = {
      ...fakePlan,
      status: 'DEFAULTED',
      instalments: fakePlan.instalments.map((i) => ({ ...i, status: 'COMPLETED' })),
    };
    mockedPlanRepo.getById
      .mockResolvedValueOnce(fakePlan as any) // initial load (still ACTIVE)
      .mockResolvedValueOnce(defaultedPlan as any); // refresh shows DEFAULTED
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(result.planMarkedCompleted).toBe(false);
  });

  it('handles a Decimal-string instalment amount (Prisma compat)', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...fakeInstalment,
      amount: { toString: () => '300.00' },
    } as any);
    mockedPaymentRepo.getById.mockResolvedValue({
      ...fakePayment,
      amount: { toString: () => '300.00' },
    } as any);
    const result = await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    expect(result.instalmentMarkedPaid).toBe(true);
  });

  it('uses now() as paidDate when payment.transactionDate is null', async () => {
    mockedPaymentRepo.getById.mockResolvedValue({ ...fakePayment, transactionDate: null } as any);
    await service.recordPayment(
      'inst-1',
      { paymentId: 'pay-1' },
      'user-1',
      fakeReq,
    );
    const updateCall = mockedRepo.update.mock.calls.at(-1);
    expect(updateCall?.[1]).toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    expect((updateCall?.[1] as any).paidDate).toBeInstanceOf(Date);
  });
});

describe('paymentInstalmentsService CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById throws NotFoundError when the instalment is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('update emits payment_instalment.status_changed when status moves', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inst-1',
      paymentPlanId: 'plan-1',
      instalmentNum: 1,
      status: 'PENDING',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'inst-1',
      paymentPlanId: 'plan-1',
      instalmentNum: 1,
      status: 'COMPLETED',
    } as any);

    await service.update('inst-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment_instalment.updated')).toBeDefined();
    const statusChanged = findEvent('payment_instalment.status_changed');
    expect(statusChanged).toBeDefined();
    expect(statusChanged?.data).toEqual(
      expect.objectContaining({ previousStatus: 'PENDING', newStatus: 'COMPLETED' }),
    );
  });

  it('update does NOT emit status_changed when status is unchanged', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inst-1',
      paymentPlanId: 'plan-1',
      instalmentNum: 1,
      status: 'PENDING',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'inst-1',
      paymentPlanId: 'plan-1',
      instalmentNum: 1,
      status: 'PENDING',
    } as any);

    await service.update('inst-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment_instalment.updated')).toBeDefined();
    expect(findEvent('payment_instalment.status_changed')).toBeUndefined();
  });

  it('remove hard-deletes through the repo, audits, and emits payment_instalment.deleted', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inst-1',
      paymentPlanId: 'plan-1',
      instalmentNum: 1,
      status: 'CANCELLED',
    } as any);

    await service.remove('inst-1', 'user-1', fakeReq);
    expect(mockedRepo.remove).toHaveBeenCalledWith('inst-1');
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'PaymentInstalment',
      'inst-1',
      'DELETE',
      'user-1',
      expect.any(Object),
      null,
      fakeReq,
    );
    expect(findEvent('payment_instalment.deleted')).toBeDefined();
  });
});
