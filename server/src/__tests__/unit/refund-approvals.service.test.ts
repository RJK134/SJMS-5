import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

vi.mock('../../repositories/refundApproval.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/refund-approvals/refund-approvals.service';
import * as repo from '../../repositories/refundApproval.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeRefund = {
  id: 'rfn-1',
  studentAccountId: 'acct-1',
  amount: '350',
  reason: 'Module withdrawal — pro-rata refund',
  approvedBy: null,
  approvedDate: null,
  processedDate: null,
  status: 'REQUESTED',
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

describe('refund-approvals.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the refund when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeRefund as any);
      const result = await service.getById('rfn-1');
      expect(result).toEqual(fakeRefund);
    });

    it('throws NotFoundError when the refund does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates a REQUESTED refund, audits, and emits refund_approval.created', async () => {
      mockedRepo.create.mockResolvedValue(fakeRefund as any);

      await service.create(
        {
          studentAccountId: 'acct-1',
          amount: 350,
          reason: 'Module withdrawal — pro-rata refund',
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'RefundApproval',
        'rfn-1',
        'CREATE',
        'user-42',
        null,
        fakeRefund,
        fakeReq,
      );
      const event = findEvent('refund_approval.created') as any;
      expect(event).toBeDefined();
      expect(event.data.amount).toBe(350);
      expect(event.data.status).toBe('REQUESTED');
    });
  });

  describe('update()', () => {
    it('emits refund_approval.updated and refund_approval.status_changed when status flips REQUESTED → APPROVED', async () => {
      const previous = { ...fakeRefund, status: 'REQUESTED' };
      const updated = {
        ...fakeRefund,
        status: 'APPROVED',
        approvedBy: 'user-finance-2',
        approvedDate: new Date('2025-12-10'),
      };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update(
        'rfn-1',
        {
          status: 'APPROVED',
          approvedBy: 'user-finance-2',
          approvedDate: new Date('2025-12-10'),
        } as any,
        'user-42',
        fakeReq,
      );

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('refund_approval.updated');
      expect(events).toContain('refund_approval.status_changed');

      const statusEvent = findEvent('refund_approval.status_changed') as any;
      expect(statusEvent.data.previousStatus).toBe('REQUESTED');
      expect(statusEvent.data.newStatus).toBe('APPROVED');
      expect(statusEvent.data.amount).toBe(350);
    });

    it('does NOT emit status_changed when only metadata is updated', async () => {
      const previous = { ...fakeRefund, status: 'APPROVED', reason: 'old reason' };
      const updated = { ...fakeRefund, status: 'APPROVED', reason: 'new reason' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('rfn-1', { reason: 'new reason' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('refund_approval.updated');
      expect(events).not.toContain('refund_approval.status_changed');
    });

    it('throws NotFoundError when updating a missing refund', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: 'APPROVED' } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('hard-deletes, audits, and emits refund_approval.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeRefund as any);
      mockedRepo.remove.mockResolvedValue(undefined as any);

      await service.remove('rfn-1', 'user-42', fakeReq);

      expect(mockedRepo.remove).toHaveBeenCalledWith('rfn-1');
      const event = findEvent('refund_approval.deleted') as any;
      expect(event).toBeDefined();
      expect(event.data.amount).toBe(350);
    });

    it('throws NotFoundError if the refund does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards studentAccountId / status filters to repo.list', async () => {
      mockedRepo.list.mockResolvedValue({
        data: [],
        pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      } as any);

      await service.list({
        cursor: undefined,
        limit: 25,
        sort: 'createdAt',
        order: 'desc',
        studentAccountId: 'acct-1',
        status: 'APPROVED',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        { studentAccountId: 'acct-1', status: 'APPROVED' },
        expect.objectContaining({ limit: 25, sort: 'createdAt', order: 'desc' }),
      );
    });
  });
});
