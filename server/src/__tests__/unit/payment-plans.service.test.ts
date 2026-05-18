import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ────────────────
vi.mock('../../utils/prisma', () => ({
  default: { $transaction: vi.fn(async (cb: any) => cb({})) },
}));
vi.mock('../../repositories/paymentPlan.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  findActiveByStudentAccount: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  createWithInstalments: vi.fn(),
}));
vi.mock('../../repositories/finance.repository', () => ({
  getAccountById: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/payment-plans/payment-plans.service';
import * as repo from '../../repositories/paymentPlan.repository';
import * as financeRepo from '../../repositories/finance.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedFinanceRepo = vi.mocked(financeRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('paymentPlansService.generatePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFinanceRepo.getAccountById.mockResolvedValue({
      id: 'acct-1',
      studentId: 'stu-1',
      academicYear: '2025/26',
      balance: 0,
      status: 'ACTIVE',
      deletedAt: null,
    } as any);
  });

  it('throws NotFoundError when the StudentAccount does not exist', async () => {
    mockedFinanceRepo.getAccountById.mockResolvedValue(null);
    await expect(
      service.generatePlan(
        {
          studentAccountId: 'missing',
          totalAmount: 900,
          numberOfInstalments: 3,
          startDate: new Date(Date.UTC(2026, 0, 1)),
        },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('preview mode (persist:false) does not call createWithInstalments and emits schedule_generated', async () => {
    const result = await service.generatePlan(
      {
        studentAccountId: 'acct-1',
        totalAmount: 900,
        numberOfInstalments: 3,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        persist: false,
      },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(false);
    expect(result.paymentPlanId).toBeNull();
    expect(result.schedule.numberOfInstalments).toBe(3);
    expect(mockedRepo.createWithInstalments).not.toHaveBeenCalled();

    const generated = findEvent('payment_plan.schedule_generated');
    expect(generated).toBeDefined();
    expect(generated?.data).toEqual(expect.objectContaining({
      paymentPlanId: null,
      frequency: 'MONTHLY',
      totalAmount: 900,
      numberOfInstalments: 3,
      persisted: false,
    }));
  });

  it('persist mode writes the plan + instalments and emits payment_plan.created + schedule_generated', async () => {
    mockedRepo.createWithInstalments.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      numberOfInstalments: 3,
      instalmentAmount: 300,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      status: 'ACTIVE',
      instalments: [],
    } as any);

    const result = await service.generatePlan(
      {
        studentAccountId: 'acct-1',
        totalAmount: 900,
        numberOfInstalments: 3,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(true);
    expect(result.paymentPlanId).toBe('plan-1');
    expect(mockedRepo.createWithInstalments).toHaveBeenCalledTimes(1);

    const [planArg, instArg] = mockedRepo.createWithInstalments.mock.calls[0]!;
    expect(planArg).toEqual(expect.objectContaining({
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      numberOfInstalments: 3,
      instalmentAmount: 300,
      status: 'ACTIVE',
      createdBy: 'user-1',
    }));
    expect(instArg).toHaveLength(3);
    expect(instArg.map((i: any) => i.amount)).toEqual([300, 300, 300]);
    expect(instArg.every((i: any) => i.status === 'PENDING')).toBe(true);

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'PaymentPlan',
      'plan-1',
      'CREATE',
      'user-1',
      null,
      expect.any(Object),
      fakeReq,
    );
    expect(findEvent('payment_plan.created')).toBeDefined();
    const generated = findEvent('payment_plan.schedule_generated');
    expect(generated).toBeDefined();
    expect(generated?.data).toEqual(expect.objectContaining({
      paymentPlanId: 'plan-1',
      persisted: true,
    }));
  });

  it('refuses to persist when the schedule is empty (zero instalments)', async () => {
    await expect(
      service.generatePlan(
        {
          studentAccountId: 'acct-1',
          totalAmount: 900,
          numberOfInstalments: 0,
          startDate: new Date(Date.UTC(2026, 0, 1)),
        },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.createWithInstalments).not.toHaveBeenCalled();
  });

  it('refuses to persist when the schedule is empty (zero totalAmount)', async () => {
    await expect(
      service.generatePlan(
        {
          studentAccountId: 'acct-1',
          totalAmount: 0,
          numberOfInstalments: 3,
          startDate: new Date(Date.UTC(2026, 0, 1)),
        },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('forwards the planType override to the repo', async () => {
    mockedRepo.createWithInstalments.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'TUITION_INSTALMENTS',
      totalAmount: 1200,
      numberOfInstalments: 4,
      instalmentAmount: 300,
      status: 'ACTIVE',
      instalments: [],
    } as any);

    await service.generatePlan(
      {
        studentAccountId: 'acct-1',
        planType: 'TUITION_INSTALMENTS',
        totalAmount: 1200,
        numberOfInstalments: 4,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      },
      'user-1',
      fakeReq,
    );

    const [planArg] = mockedRepo.createWithInstalments.mock.calls[0]!;
    expect(planArg.planType).toBe('TUITION_INSTALMENTS');
  });

  it('forwards the frequency override (QUARTERLY) into the schedule and emits it on the event', async () => {
    const result = await service.generatePlan(
      {
        studentAccountId: 'acct-1',
        totalAmount: 1200,
        numberOfInstalments: 4,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        frequency: 'QUARTERLY',
        persist: false,
      },
      'user-1',
      fakeReq,
    );

    expect(result.schedule.frequency).toBe('QUARTERLY');
    const generated = findEvent('payment_plan.schedule_generated');
    expect(generated?.data).toEqual(expect.objectContaining({ frequency: 'QUARTERLY' }));
  });

  it('honours initialStatus override', async () => {
    mockedRepo.createWithInstalments.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      numberOfInstalments: 3,
      instalmentAmount: 300,
      status: 'DEFAULTED',
      instalments: [],
    } as any);

    await service.generatePlan(
      {
        studentAccountId: 'acct-1',
        totalAmount: 900,
        numberOfInstalments: 3,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        initialStatus: 'DEFAULTED',
      },
      'user-1',
      fakeReq,
    );

    const [planArg] = mockedRepo.createWithInstalments.mock.calls[0]!;
    expect(planArg.status).toBe('DEFAULTED');
  });
});

describe('paymentPlansService CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById throws NotFoundError when the plan is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('create throws ValidationError directing the caller to POST /v1/payment-plans/generate', async () => {
    await expect(service.create({} as any, 'user-1', fakeReq)).rejects.toThrow(ValidationError);
    expect(mockedRepo.create).not.toHaveBeenCalled();
  });

  it('update emits payment_plan.status_changed when status moves', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      status: 'ACTIVE',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      status: 'COMPLETED',
    } as any);

    await service.update('plan-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment_plan.updated')).toBeDefined();
    const statusChanged = findEvent('payment_plan.status_changed');
    expect(statusChanged).toBeDefined();
    expect(statusChanged?.data).toEqual(
      expect.objectContaining({ previousStatus: 'ACTIVE', newStatus: 'COMPLETED' }),
    );
  });

  it('update does NOT emit status_changed when status is unchanged', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      status: 'ACTIVE',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      totalAmount: 900,
      status: 'ACTIVE',
    } as any);

    await service.update('plan-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('payment_plan.updated')).toBeDefined();
    expect(findEvent('payment_plan.status_changed')).toBeUndefined();
  });

  it('remove hard-deletes through the repo, audits, and emits payment_plan.deleted', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'plan-1',
      studentAccountId: 'acct-1',
      planType: 'INSTALMENT_PLAN',
      status: 'CANCELLED',
    } as any);

    await service.remove('plan-1', 'user-1', fakeReq);
    expect(mockedRepo.remove).toHaveBeenCalledWith('plan-1');
    expect(findEvent('payment_plan.deleted')).toBeDefined();
  });
});
