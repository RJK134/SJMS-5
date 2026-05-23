import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// Note: must mock the WHOLE module so the existing `findAwardedByStudent`
// helper used by Phase 18A's fee-assessments.service test stays callable.
vi.mock('../../repositories/bursaryApplication.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findAwardedByStudent: vi.fn(),
  updateDecisionInTx: vi.fn(),
}));
vi.mock('../../repositories/bursaryFund.repository', () => ({
  getById: vi.fn(),
  reserveBudgetInTx: vi.fn(),
  releaseBudgetInTx: vi.fn(),
}));
vi.mock('../../utils/prisma-tx', () => ({
  runInTransaction: vi.fn(async (cb: any) => cb({})),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/bursary-applications/bursary-applications.service';
import * as repo from '../../repositories/bursaryApplication.repository';
import * as fundRepo from '../../repositories/bursaryFund.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedFundRepo = vi.mocked(fundRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeApp = {
  id: 'ba-1',
  bursaryFundId: 'bf-1',
  studentId: 'stu-1',
  applicationDate: new Date('2025-09-15'),
  circumstancesDesc: 'Living away from home, low household income.',
  householdIncome: '18500',
  status: 'SUBMITTED',
  awardAmount: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('bursary-applications.service', () => {
  beforeEach(() => {
    // Use clearAllMocks (not resetAllMocks) so the vi.mock factory
    // implementations — in particular runInTransaction's
    // `async (cb) => cb({})` — survive the reset between tests.
    vi.clearAllMocks();
  });

  describe('getById()', () => {
    it('returns the application when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeApp as any);
      const result = await service.getById('ba-1');
      expect(result).toEqual(fakeApp);
    });

    it('throws NotFoundError when the application does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates a SUBMITTED application without awardAmount and emits bursary_application.created', async () => {
      mockedRepo.create.mockResolvedValue(fakeApp as any);

      await service.create(
        {
          bursaryFundId: 'bf-1',
          studentId: 'stu-1',
          applicationDate: new Date('2025-09-15'),
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'BursaryApplication',
        'ba-1',
        'CREATE',
        'user-42',
        null,
        fakeApp,
        fakeReq,
      );
      const event = findEvent('bursary_application.created') as any;
      expect(event).toBeDefined();
      expect(event.data.awardAmount).toBeNull();
      expect(event.data.status).toBe('SUBMITTED');
    });
  });

  describe('update()', () => {
    it('emits bursary_application.updated and bursary_application.status_changed when status flips to APPROVED with awardAmount', async () => {
      const previous = { ...fakeApp, status: 'UNDER_REVIEW', awardAmount: null };
      const updated = { ...fakeApp, status: 'APPROVED', awardAmount: '1500' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update(
        'ba-1',
        { status: 'APPROVED', awardAmount: 1500 } as any,
        'user-42',
        fakeReq,
      );

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('bursary_application.updated');
      expect(events).toContain('bursary_application.status_changed');

      const statusEvent = findEvent('bursary_application.status_changed') as any;
      expect(statusEvent.data.previousStatus).toBe('UNDER_REVIEW');
      expect(statusEvent.data.newStatus).toBe('APPROVED');
      expect(statusEvent.data.awardAmount).toBe(1500);
    });

    it('tags status_changed with decisionMode: MANUAL on the operator update path', async () => {
      const previous = { ...fakeApp, status: 'UNDER_REVIEW', awardAmount: null };
      const updated = { ...fakeApp, status: 'APPROVED', awardAmount: '1500' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update(
        'ba-1',
        { status: 'APPROVED', awardAmount: 1500 } as any,
        'user-42',
        fakeReq,
      );

      const statusEvent = findEvent('bursary_application.status_changed') as any;
      expect(statusEvent.data.decisionMode).toBe('MANUAL');
    });

    it('does NOT emit status_changed when only metadata is updated', async () => {
      const previous = { ...fakeApp, status: 'UNDER_REVIEW' };
      const updated = { ...fakeApp, status: 'UNDER_REVIEW', circumstancesDesc: 'updated' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('ba-1', { circumstancesDesc: 'updated' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('bursary_application.updated');
      expect(events).not.toContain('bursary_application.status_changed');
    });

    it('throws NotFoundError when updating a missing application', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: 'APPROVED' } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('hard-deletes, audits, and emits bursary_application.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeApp as any);
      mockedRepo.remove.mockResolvedValue(undefined as any);

      await service.remove('ba-1', 'user-42', fakeReq);

      expect(mockedRepo.remove).toHaveBeenCalledWith('ba-1');
      const event = findEvent('bursary_application.deleted') as any;
      expect(event).toBeDefined();
      expect(event.data.bursaryFundId).toBe('bf-1');
      expect(event.data.studentId).toBe('stu-1');
    });

    it('throws NotFoundError if the application does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards bursaryFundId / studentId / status filters', async () => {
      mockedRepo.list.mockResolvedValue({
        data: [],
        pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      } as any);

      await service.list({
        cursor: undefined,
        limit: 25,
        sort: 'applicationDate',
        order: 'desc',
        bursaryFundId: 'bf-1',
        studentId: 'stu-1',
        status: 'APPROVED',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        { bursaryFundId: 'bf-1', studentId: 'stu-1', status: 'APPROVED' },
        expect.objectContaining({ limit: 25, sort: 'applicationDate', order: 'desc' }),
      );
    });
  });

  // ── Phase 1C — auto-decisioning ──────────────────────────────────────────
  describe('autoDecideForApplication()', () => {
    const fakeFund = {
      id: 'bf-1',
      fundName: 'Hardship 25/26',
      fundType: 'HARDSHIP',
      academicYear: '2025/26',
      totalBudget: '50000',
      allocated: '15000',
      remaining: '35000',
      eligibility: null,
    };

    it('throws NotFoundError when the application does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.autoDecideForApplication('missing', {}, 'staff-9', fakeReq),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when the bursary fund is missing', async () => {
      mockedRepo.getById.mockResolvedValue(fakeApp as any);
      mockedFundRepo.getById.mockResolvedValue(null);
      await expect(
        service.autoDecideForApplication('ba-1', {}, 'staff-9', fakeReq),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses to re-evaluate a terminal-status row without force', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, status: 'APPROVED' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);
      await expect(
        service.autoDecideForApplication('ba-1', {}, 'staff-9', fakeReq),
      ).rejects.toThrow(ValidationError);
      expect(mockedRepo.updateDecisionInTx).not.toHaveBeenCalled();
    });

    it('APPROVE happy path: reserves budget, flips status, audits AUTO + emits events', async () => {
      // fakeApp.householdIncome '18500' falls between thresholds → REVIEW.
      // Override to '12000' to land inside the auto-approve band.
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, householdIncome: '12000' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication(
        'ba-1',
        {},
        'staff-9',
        fakeReq,
      );

      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(1000);
      expect(result.budgetReserved).toBe(1000);
      expect(result.budgetReleased).toBe(0);
      expect(result.persisted).toBe(true);
      expect(result.newStatus).toBe('APPROVED');

      expect(mockedFundRepo.reserveBudgetInTx).toHaveBeenCalledWith(
        'bf-1',
        1000,
        expect.any(Object),
      );
      expect(mockedRepo.updateDecisionInTx).toHaveBeenCalledWith(
        'ba-1',
        expect.objectContaining({ status: 'APPROVED', awardAmount: 1000, updatedBy: 'staff-9' }),
        expect.any(Object),
      );

      const auditNewData = mockedLogAudit.mock.calls[0][5] as Record<string, unknown>;
      expect(auditNewData.decisionMode).toBe('AUTO');
      expect(auditNewData.decision).toBe('APPROVE');

      const autoEvent = findEvent('bursary_application.auto_decided') as any;
      expect(autoEvent.data.decisionMode).toBe('AUTO');
      expect(autoEvent.data.budgetReserved).toBe(1000);

      const statusEvent = findEvent('bursary_application.status_changed') as any;
      expect(statusEvent.data.decisionMode).toBe('AUTO');
    });

    it('REJECT path: no budget mutation; awardAmount cleared', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, householdIncome: '80000' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication('ba-1', {}, 'staff-9', fakeReq);

      expect(result.decision).toBe('REJECT');
      expect(result.suggestedAward).toBe(0);
      expect(mockedFundRepo.reserveBudgetInTx).not.toHaveBeenCalled();
      expect(mockedFundRepo.releaseBudgetInTx).not.toHaveBeenCalled();
      expect(mockedRepo.updateDecisionInTx).toHaveBeenCalledWith(
        'ba-1',
        expect.objectContaining({ status: 'REJECTED', awardAmount: null }),
        expect.any(Object),
      );
    });

    it('REVIEW path: flips SUBMITTED → UNDER_REVIEW, no awardAmount key in patch', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, householdIncome: '30000' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication('ba-1', {}, 'staff-9', fakeReq);

      expect(result.decision).toBe('REVIEW');
      expect(result.newStatus).toBe('UNDER_REVIEW');
      expect(mockedFundRepo.reserveBudgetInTx).not.toHaveBeenCalled();
      const patch = mockedRepo.updateDecisionInTx.mock.calls[0][1] as Record<string, unknown>;
      expect(patch).not.toHaveProperty('awardAmount');
    });

    it('preview mode (persist:false) runs the rule but never mutates', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, householdIncome: '12000' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication(
        'ba-1',
        { persist: false },
        'staff-9',
        fakeReq,
      );

      expect(result.decision).toBe('APPROVE');
      expect(result.persisted).toBe(false);
      expect(mockedRepo.updateDecisionInTx).not.toHaveBeenCalled();
      expect(mockedFundRepo.reserveBudgetInTx).not.toHaveBeenCalled();

      const autoEvent = findEvent('bursary_application.auto_decided') as any;
      expect(autoEvent.data.persisted).toBe(false);
    });

    it('per-call rule overrides flow through to the pure engine', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeApp, householdIncome: '25000' } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication(
        'ba-1',
        {
          rules: {
            autoApproveBelowIncome: 30000,
            autoRejectAboveIncome: 80000,
            defaultAwardAmount: 2000,
            maxAwardPerStudent: 2000,
          },
        },
        'staff-9',
        fakeReq,
      );

      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(2000);
      expect(result.effectiveRules.defaultAwardAmount).toBe(2000);
    });

    it('force re-evaluating an APPROVED → REJECT releases the previously reserved budget', async () => {
      mockedRepo.getById.mockResolvedValue({
        ...fakeApp,
        status: 'APPROVED',
        awardAmount: '1500',
        householdIncome: '80000',
      } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      const result = await service.autoDecideForApplication(
        'ba-1',
        { force: true },
        'staff-9',
        fakeReq,
      );

      expect(result.decision).toBe('REJECT');
      expect(result.budgetReleased).toBe(1500);
      expect(result.budgetReserved).toBe(0);
      expect(mockedFundRepo.releaseBudgetInTx).toHaveBeenCalledWith('bf-1', 1500, expect.any(Object));
      expect(mockedFundRepo.reserveBudgetInTx).not.toHaveBeenCalled();
    });

    it('force re-evaluating APPROVED with a larger award reserves only the delta', async () => {
      mockedRepo.getById.mockResolvedValue({
        ...fakeApp,
        status: 'APPROVED',
        awardAmount: '500',
        householdIncome: '12000',
      } as any);
      mockedFundRepo.getById.mockResolvedValue({
        ...fakeFund,
        eligibility: { defaultAwardAmount: 1000, maxAwardPerStudent: 1000 },
      } as any);

      const result = await service.autoDecideForApplication(
        'ba-1',
        { force: true },
        'staff-9',
        fakeReq,
      );

      expect(result.decision).toBe('APPROVE');
      expect(result.budgetReserved).toBe(500);
      expect(result.budgetReleased).toBe(0);
    });

    it('does not emit status_changed when UNDER_REVIEW → UNDER_REVIEW (no-op)', async () => {
      mockedRepo.getById.mockResolvedValue({
        ...fakeApp,
        status: 'UNDER_REVIEW',
        householdIncome: '30000',
      } as any);
      mockedFundRepo.getById.mockResolvedValue(fakeFund as any);

      await service.autoDecideForApplication('ba-1', {}, 'staff-9', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('bursary_application.auto_decided');
      expect(events).not.toContain('bursary_application.status_changed');
      expect(mockedRepo.updateDecisionInTx).not.toHaveBeenCalled();
    });
  });
});
