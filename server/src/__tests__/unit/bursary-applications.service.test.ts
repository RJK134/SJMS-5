import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

// Note: must mock the WHOLE module so the existing `findAwardedByStudent`
// helper used by Phase 18A's fee-assessments.service test stays callable.
vi.mock('../../repositories/bursaryApplication.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findAwardedByStudent: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/bursary-applications/bursary-applications.service';
import * as repo from '../../repositories/bursaryApplication.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
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
    vi.resetAllMocks();
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
});
