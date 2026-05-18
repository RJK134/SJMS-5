import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/sponsorAgreement.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findActiveByStudentYear: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/sponsor-agreements/sponsor-agreements.service';
import * as repo from '../../repositories/sponsorAgreement.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeAgreement = {
  id: 'spa-1',
  studentAccountId: 'acct-1',
  sponsorName: 'Acme Education Trust',
  sponsorType: 'CHARITY',
  agreementRef: 'ACME-2025-001',
  academicYear: '2025/26',
  amountAgreed: '12000',
  amountReceived: '0',
  status: 'active',
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

describe('sponsor-agreements.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the agreement when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeAgreement as any);
      const result = await service.getById('spa-1');
      expect(result).toEqual(fakeAgreement);
    });

    it('throws NotFoundError when the agreement does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates an agreement, audits, and emits sponsor_agreement.created with Decimal-as-string compat', async () => {
      mockedRepo.create.mockResolvedValue(fakeAgreement as any);

      const result = await service.create(
        {
          studentAccountId: 'acct-1',
          sponsorName: 'Acme Education Trust',
          sponsorType: 'CHARITY',
          academicYear: '2025/26',
          amountAgreed: 12000,
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedRepo.create).toHaveBeenCalledTimes(1);
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'SponsorAgreement',
        'spa-1',
        'CREATE',
        'user-42',
        null,
        fakeAgreement,
        fakeReq,
      );
      const event = findEvent('sponsor_agreement.created');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        studentAccountId: 'acct-1',
        sponsorName: 'Acme Education Trust',
        sponsorType: 'CHARITY',
        academicYear: '2025/26',
        amountAgreed: 12000,
        status: 'active',
      });
      expect(result.id).toBe('spa-1');
    });
  });

  describe('update()', () => {
    it('emits sponsor_agreement.updated and sponsor_agreement.status_changed when status flips', async () => {
      const previous = { ...fakeAgreement, status: 'active' };
      const updated = { ...fakeAgreement, status: 'cancelled' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('spa-1', { status: 'cancelled' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor_agreement.updated');
      expect(events).toContain('sponsor_agreement.status_changed');

      const statusEvent = findEvent('sponsor_agreement.status_changed') as any;
      expect(statusEvent.data.previousStatus).toBe('active');
      expect(statusEvent.data.newStatus).toBe('cancelled');
    });

    it('does NOT emit status_changed when only metadata is updated', async () => {
      const previous = { ...fakeAgreement, sponsorName: 'Old Name' };
      const updated = { ...fakeAgreement, sponsorName: 'New Name' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('spa-1', { sponsorName: 'New Name' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor_agreement.updated');
      expect(events).not.toContain('sponsor_agreement.status_changed');
    });

    it('throws NotFoundError when updating a missing agreement', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: 'cancelled' } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('hard-deletes via repo.remove, audits, and emits sponsor_agreement.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeAgreement as any);
      mockedRepo.remove.mockResolvedValue(undefined as any);

      await service.remove('spa-1', 'user-42', fakeReq);

      expect(mockedRepo.remove).toHaveBeenCalledWith('spa-1');
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'SponsorAgreement',
        'spa-1',
        'DELETE',
        'user-42',
        fakeAgreement,
        null,
        fakeReq,
      );
      const event = findEvent('sponsor_agreement.deleted');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        studentAccountId: 'acct-1',
        sponsorName: 'Acme Education Trust',
        academicYear: '2025/26',
      });
    });

    it('throws NotFoundError if the agreement does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards filters and pagination to repo.list', async () => {
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
        academicYear: '2025/26',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          studentAccountId: 'acct-1',
          academicYear: '2025/26',
        }),
        expect.objectContaining({ cursor: undefined, limit: 25, sort: 'createdAt', order: 'desc' }),
      );
    });
  });
});
