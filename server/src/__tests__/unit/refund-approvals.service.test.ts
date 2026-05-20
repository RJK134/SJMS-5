import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors';

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
  createdBy: 'user-registry-1',
  updatedBy: null,
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

const emittedEventNames = () =>
  mockedEmitEvent.mock.calls.map((c) =>
    typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
  );

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

  describe('create() — REGISTRY proposes', () => {
    it('forces status REQUESTED even if caller smuggles APPROVED', async () => {
      mockedRepo.create.mockResolvedValue(fakeRefund as any);

      await service.create(
        {
          studentAccountId: 'acct-1',
          amount: 350,
          reason: 'Module withdrawal — pro-rata refund',
          // Caller tries to side-load APPROVED — service must scrub this.
          status: 'APPROVED' as any,
          approvedBy: 'some-finance-user',
        } as any,
        'user-registry-1',
        fakeReq,
      );

      const createArg = mockedRepo.create.mock.calls[0]?.[0] as any;
      expect(createArg.status).toBe('REQUESTED');
      expect(createArg.approvedBy).toBeNull();
      expect(createArg.approvedDate).toBeNull();
      expect(createArg.processedDate).toBeNull();
      expect(createArg.createdBy).toBe('user-registry-1');
    });

    it('audits and emits both created + proposed events', async () => {
      mockedRepo.create.mockResolvedValue(fakeRefund as any);

      await service.create(
        {
          studentAccountId: 'acct-1',
          amount: 350,
          reason: 'Module withdrawal — pro-rata refund',
        } as any,
        'user-registry-1',
        fakeReq,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'RefundApproval',
        'rfn-1',
        'CREATE',
        'user-registry-1',
        null,
        fakeRefund,
        fakeReq,
      );
      const events = emittedEventNames();
      expect(events).toContain('refund_approval.created');
      expect(events).toContain('refund_approval.proposed');
      const proposed = findEvent('refund_approval.proposed') as any;
      expect(proposed.data.amount).toBe(350);
      expect(proposed.data.proposedBy).toBe('user-registry-1');
    });
  });

  describe('approve() — FINANCE approves', () => {
    it('moves REQUESTED → APPROVED, sets approvedBy + approvedDate, emits transition events', async () => {
      const proposed = { ...fakeRefund, status: 'REQUESTED', createdBy: 'user-registry-1' };
      const approved = {
        ...fakeRefund,
        status: 'APPROVED',
        approvedBy: 'user-finance-2',
        approvedDate: new Date('2026-05-19'),
      };
      mockedRepo.getById.mockResolvedValue(proposed as any);
      mockedRepo.update.mockResolvedValue(approved as any);

      await service.approve('rfn-1', 'user-finance-2', fakeReq);

      const updateArg = mockedRepo.update.mock.calls[0]?.[1] as any;
      expect(updateArg.status).toBe('APPROVED');
      expect(updateArg.approvedBy).toBe('user-finance-2');
      expect(updateArg.approvedDate).toBeInstanceOf(Date);
      expect(updateArg.updatedBy).toBe('user-finance-2');

      const events = emittedEventNames();
      expect(events).toContain('refund_approval.updated');
      expect(events).toContain('refund_approval.status_changed');
      expect(events).toContain('refund_approval.approved');

      const approvedEvent = findEvent('refund_approval.approved') as any;
      expect(approvedEvent.data.amount).toBe(350);
      expect(approvedEvent.data.approvedBy).toBe('user-finance-2');
      expect(approvedEvent.data.proposedBy).toBe('user-registry-1');
    });

    it('blocks self-approval — proposer cannot approve their own refund', async () => {
      const proposed = { ...fakeRefund, status: 'REQUESTED', createdBy: 'user-registry-1' };
      mockedRepo.getById.mockResolvedValue(proposed as any);

      await expect(
        service.approve('rfn-1', 'user-registry-1', fakeReq),
      ).rejects.toThrow(ForbiddenError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('rejects approval from APPROVED state (terminal)', async () => {
      const already = { ...fakeRefund, status: 'APPROVED' };
      mockedRepo.getById.mockResolvedValue(already as any);

      await expect(service.approve('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('rejects approval from PROCESSED state', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeRefund, status: 'PROCESSED' } as any);
      await expect(service.approve('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
    });

    it('rejects approval from REJECTED state', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeRefund, status: 'REJECTED' } as any);
      await expect(service.approve('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws NotFoundError when refund does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.approve('missing', 'user-finance-2', fakeReq)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('reject() — FINANCE rejects', () => {
    it('moves REQUESTED → REJECTED, appends reason to history, emits rejected event', async () => {
      const proposed = {
        ...fakeRefund,
        status: 'REQUESTED',
        reason: 'Original reason',
        createdBy: 'user-registry-1',
      };
      const rejected = {
        ...fakeRefund,
        status: 'REJECTED',
        approvedBy: 'user-finance-2',
        reason: 'Original reason\n\n[REJECTED by user-finance-2]: Insufficient evidence',
      };
      mockedRepo.getById.mockResolvedValue(proposed as any);
      mockedRepo.update.mockResolvedValue(rejected as any);

      await service.reject('rfn-1', 'user-finance-2', 'Insufficient evidence', fakeReq);

      const updateArg = mockedRepo.update.mock.calls[0]?.[1] as any;
      expect(updateArg.status).toBe('REJECTED');
      expect(updateArg.approvedBy).toBe('user-finance-2');
      expect(updateArg.reason).toContain('[REJECTED by user-finance-2]: Insufficient evidence');

      const events = emittedEventNames();
      expect(events).toContain('refund_approval.rejected');
      const rejectedEvent = findEvent('refund_approval.rejected') as any;
      expect(rejectedEvent.data.reason).toBe('Insufficient evidence');
      expect(rejectedEvent.data.rejectedBy).toBe('user-finance-2');
    });

    it('accepts rejection with no reason payload', async () => {
      const proposed = { ...fakeRefund, status: 'REQUESTED' };
      const rejected = { ...fakeRefund, status: 'REJECTED', approvedBy: 'user-finance-2' };
      mockedRepo.getById.mockResolvedValue(proposed as any);
      mockedRepo.update.mockResolvedValue(rejected as any);

      await service.reject('rfn-1', 'user-finance-2', undefined, fakeReq);

      const updateArg = mockedRepo.update.mock.calls[0]?.[1] as any;
      // When no reason supplied, the original reason field stays untouched.
      expect(updateArg.reason).toBeUndefined();
      const rejectedEvent = findEvent('refund_approval.rejected') as any;
      expect(rejectedEvent.data.reason).toBeNull();
    });

    it('rejects rejection from APPROVED state (already past decision point)', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeRefund, status: 'APPROVED' } as any);
      await expect(
        service.reject('rfn-1', 'user-finance-2', 'too late', fakeReq),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('process() — FINANCE processes', () => {
    it('moves APPROVED → PROCESSED, sets processedDate, emits processed event', async () => {
      const approved = {
        ...fakeRefund,
        status: 'APPROVED',
        approvedBy: 'user-finance-2',
        approvedDate: new Date('2026-05-19'),
      };
      const processed = {
        ...fakeRefund,
        status: 'PROCESSED',
        approvedBy: 'user-finance-2',
        approvedDate: new Date('2026-05-19'),
        processedDate: new Date('2026-05-20'),
      };
      mockedRepo.getById.mockResolvedValue(approved as any);
      mockedRepo.update.mockResolvedValue(processed as any);

      await service.process('rfn-1', 'user-finance-3', fakeReq);

      const updateArg = mockedRepo.update.mock.calls[0]?.[1] as any;
      expect(updateArg.status).toBe('PROCESSED');
      expect(updateArg.processedDate).toBeInstanceOf(Date);

      const events = emittedEventNames();
      expect(events).toContain('refund_approval.processed');
      const processedEvent = findEvent('refund_approval.processed') as any;
      expect(processedEvent.data.processedBy).toBe('user-finance-3');
      expect(processedEvent.data.amount).toBe(350);
    });

    it('rejects process from REQUESTED (must be APPROVED first)', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeRefund, status: 'REQUESTED' } as any);
      await expect(service.process('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
    });

    it('rejects process from REJECTED (terminal)', async () => {
      mockedRepo.getById.mockResolvedValue({ ...fakeRefund, status: 'REJECTED' } as any);
      await expect(service.process('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
    });

    it('rejects process from PROCESSED (idempotent re-process blocked)', async () => {
      mockedRepo.getById.mockResolvedValue({
        ...fakeRefund,
        status: 'PROCESSED',
      } as any);
      await expect(service.process('rfn-1', 'user-finance-2', fakeReq)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('update() — clerical PATCH (SUPER_ADMIN only at router layer)', () => {
    it('emits refund_approval.updated and refund_approval.status_changed when status flips REQUESTED → APPROVED', async () => {
      const previous = { ...fakeRefund, status: 'REQUESTED' };
      const updated = {
        ...fakeRefund,
        status: 'APPROVED',
        approvedBy: 'user-finance-2',
        approvedDate: new Date('2026-05-19'),
      };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update(
        'rfn-1',
        {
          status: 'APPROVED',
          approvedBy: 'user-finance-2',
          approvedDate: new Date('2026-05-19'),
        } as any,
        'user-42',
        fakeReq,
      );

      const events = emittedEventNames();
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

      const events = emittedEventNames();
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
