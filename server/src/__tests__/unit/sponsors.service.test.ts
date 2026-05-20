import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/sponsor.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  findByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/sponsors/sponsors.service';
import * as repo from '../../repositories/sponsor.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeSponsor = {
  id: 'spn-1',
  name: 'Saudi Cultural Bureau',
  sponsorType: 'EMBASSY',
  contactName: 'Ahmed Al-Saud',
  contactEmail: 'finance@scb.example',
  contactPhone: '+44 20 7000 0000',
  addressLine1: '1 Cromwell Road',
  addressLine2: null,
  city: 'London',
  postcode: 'SW7 2DR',
  country: 'United Kingdom',
  taxRef: null,
  isActive: true,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('sponsors.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the sponsor when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeSponsor as any);
      const result = await service.getById('spn-1');
      expect(result).toEqual(fakeSponsor);
    });

    it('throws NotFoundError when the sponsor does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates a sponsor, audits, and emits sponsor.created', async () => {
      mockedRepo.create.mockResolvedValue(fakeSponsor as any);

      const result = await service.create(
        {
          name: 'Saudi Cultural Bureau',
          sponsorType: 'EMBASSY',
          country: 'United Kingdom',
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedRepo.create).toHaveBeenCalledTimes(1);
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'Sponsor',
        'spn-1',
        'CREATE',
        'user-42',
        null,
        fakeSponsor,
        fakeReq,
      );
      const event = findEvent('sponsor.created');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        name: 'Saudi Cultural Bureau',
        sponsorType: 'EMBASSY',
        isActive: true,
        country: 'United Kingdom',
      });
      expect(result.id).toBe('spn-1');
    });
  });

  describe('update()', () => {
    it('emits sponsor.updated and sponsor.status_changed when isActive flips', async () => {
      const previous = { ...fakeSponsor, isActive: true };
      const updated = { ...fakeSponsor, isActive: false };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('spn-1', { isActive: false } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor.updated');
      expect(events).toContain('sponsor.status_changed');

      const statusEvent = findEvent('sponsor.status_changed') as any;
      expect(statusEvent.data.previousIsActive).toBe(true);
      expect(statusEvent.data.newIsActive).toBe(false);
    });

    it('does NOT emit status_changed when only metadata is updated', async () => {
      const previous = { ...fakeSponsor, name: 'Old Name' };
      const updated = { ...fakeSponsor, name: 'New Name' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('spn-1', { name: 'New Name' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor.updated');
      expect(events).not.toContain('sponsor.status_changed');
    });

    it('throws NotFoundError when updating a missing sponsor', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'X' } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('soft-deletes via repo.softDelete, audits, and emits sponsor.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeSponsor as any);
      mockedRepo.softDelete.mockResolvedValue(fakeSponsor as any);

      await service.remove('spn-1', 'user-42', fakeReq);

      expect(mockedRepo.softDelete).toHaveBeenCalledWith('spn-1');
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'Sponsor',
        'spn-1',
        'DELETE',
        'user-42',
        fakeSponsor,
        null,
        fakeReq,
      );
      const event = findEvent('sponsor.deleted');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        name: 'Saudi Cultural Bureau',
        sponsorType: 'EMBASSY',
      });
    });

    it('throws NotFoundError if the sponsor does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.softDelete).not.toHaveBeenCalled();
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
        sort: 'name',
        order: 'asc',
        sponsorType: 'CHARITY',
        isActive: true,
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          sponsorType: 'CHARITY',
          isActive: true,
        }),
        expect.objectContaining({ cursor: undefined, limit: 25, sort: 'name', order: 'asc' }),
      );
    });

    it('passes name filter to the repo', async () => {
      mockedRepo.list.mockResolvedValue({
        data: [],
        pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      } as any);

      await service.list({
        cursor: undefined,
        limit: 25,
        sort: 'name',
        order: 'asc',
        name: 'Saudi',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Saudi' }),
        expect.anything(),
      );
    });
  });
});
