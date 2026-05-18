import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

vi.mock('../../repositories/creditNote.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/credit-notes/credit-notes.service';
import * as repo from '../../repositories/creditNote.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeNote = {
  id: 'cn-1',
  invoiceId: 'inv-1',
  amount: '500',
  reason: 'Adjustment for early withdrawal',
  issuedBy: 'user-finance-1',
  issuedDate: new Date('2025-12-01'),
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

describe('credit-notes.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the credit note when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeNote as any);
      const result = await service.getById('cn-1');
      expect(result).toEqual(fakeNote);
    });

    it('throws NotFoundError when the credit note does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates a credit note, audits, and emits credit_note.created with Decimal-as-string compat', async () => {
      mockedRepo.create.mockResolvedValue(fakeNote as any);

      await service.create(
        {
          invoiceId: 'inv-1',
          amount: 500,
          reason: 'Adjustment for early withdrawal',
          issuedDate: new Date('2025-12-01'),
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedLogAudit).toHaveBeenCalledWith(
        'CreditNote',
        'cn-1',
        'CREATE',
        'user-42',
        null,
        fakeNote,
        fakeReq,
      );
      const event = findEvent('credit_note.created') as any;
      expect(event).toBeDefined();
      expect(event.data.invoiceId).toBe('inv-1');
      expect(event.data.amount).toBe(500);
    });
  });

  describe('update()', () => {
    it('emits credit_note.updated', async () => {
      const previous = { ...fakeNote };
      const updated = { ...fakeNote, amount: '750' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('cn-1', { amount: 750 } as any, 'user-42', fakeReq);

      const event = findEvent('credit_note.updated') as any;
      expect(event).toBeDefined();
      expect(event.data.amount).toBe(750);
    });

    it('throws NotFoundError when updating a missing credit note', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { amount: 1 } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('hard-deletes, audits, and emits credit_note.deleted with the original amount captured', async () => {
      mockedRepo.getById.mockResolvedValue(fakeNote as any);
      mockedRepo.remove.mockResolvedValue(undefined as any);

      await service.remove('cn-1', 'user-42', fakeReq);

      expect(mockedRepo.remove).toHaveBeenCalledWith('cn-1');
      const event = findEvent('credit_note.deleted') as any;
      expect(event).toBeDefined();
      expect(event.data.invoiceId).toBe('inv-1');
      expect(event.data.amount).toBe(500);
    });

    it('throws NotFoundError if the credit note does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards invoiceId filter to repo.list', async () => {
      mockedRepo.list.mockResolvedValue({
        data: [],
        pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      } as any);

      await service.list({
        cursor: undefined,
        limit: 25,
        sort: 'issuedDate',
        order: 'desc',
        invoiceId: 'inv-1',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        { invoiceId: 'inv-1' },
        expect.objectContaining({ limit: 25, sort: 'issuedDate', order: 'desc' }),
      );
    });
  });
});
