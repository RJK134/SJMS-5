import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/sponsorInvoice.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  findByInvoiceNumber: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock('../../repositories/sponsor.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/sponsor-invoices/sponsor-invoices.service';
import * as repo from '../../repositories/sponsorInvoice.repository';
import * as sponsorRepo from '../../repositories/sponsor.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedSponsorRepo = vi.mocked(sponsorRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeSponsor = {
  id: 'spn-1',
  name: 'Saudi Cultural Bureau',
  sponsorType: 'EMBASSY',
  isActive: true,
} as any;

const fakeInvoice = {
  id: 'sinv-1',
  sponsorId: 'spn-1',
  sponsorAgreementId: 'spa-1',
  invoiceNumber: 'SINV-2025-001',
  issueDate: new Date('2025-10-01'),
  dueDate: new Date('2025-10-31'),
  academicYear: '2025/26',
  amount: '12000',
  paidAmount: '0',
  currency: 'GBP',
  status: 'DRAFT',
  sentDate: null,
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

describe('sponsor-invoices.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the invoice when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeInvoice as any);
      const result = await service.getById('sinv-1');
      expect(result).toEqual(fakeInvoice);
    });

    it('throws NotFoundError when the invoice does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates an invoice, audits, and emits sponsor_invoice.created with Decimal-as-string compat', async () => {
      mockedSponsorRepo.getById.mockResolvedValue(fakeSponsor);
      mockedRepo.findByInvoiceNumber.mockResolvedValue(null);
      mockedRepo.create.mockResolvedValue(fakeInvoice as any);

      const result = await service.create(
        {
          sponsorId: 'spn-1',
          sponsorAgreementId: 'spa-1',
          invoiceNumber: 'SINV-2025-001',
          issueDate: new Date('2025-10-01'),
          dueDate: new Date('2025-10-31'),
          academicYear: '2025/26',
          amount: 12000,
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedRepo.create).toHaveBeenCalledTimes(1);
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'SponsorInvoice',
        'sinv-1',
        'CREATE',
        'user-42',
        null,
        fakeInvoice,
        fakeReq,
      );
      const event = findEvent('sponsor_invoice.created');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        sponsorId: 'spn-1',
        sponsorAgreementId: 'spa-1',
        invoiceNumber: 'SINV-2025-001',
        academicYear: '2025/26',
        amount: 12000,
        status: 'DRAFT',
      });
      expect(result.id).toBe('sinv-1');
    });

    it('throws ValidationError when sponsor does not exist', async () => {
      mockedSponsorRepo.getById.mockResolvedValue(null);

      await expect(
        service.create(
          {
            sponsorId: 'missing',
            invoiceNumber: 'X',
            issueDate: new Date(),
            dueDate: new Date(),
            academicYear: '2025/26',
            amount: 100,
          } as any,
          'user-42',
          fakeReq,
        ),
      ).rejects.toThrow(ValidationError);

      expect(mockedRepo.create).not.toHaveBeenCalled();
    });

    it('throws ValidationError on duplicate invoiceNumber', async () => {
      mockedSponsorRepo.getById.mockResolvedValue(fakeSponsor);
      mockedRepo.findByInvoiceNumber.mockResolvedValue(fakeInvoice as any);

      await expect(
        service.create(
          {
            sponsorId: 'spn-1',
            invoiceNumber: 'SINV-2025-001',
            issueDate: new Date(),
            dueDate: new Date(),
            academicYear: '2025/26',
            amount: 100,
          } as any,
          'user-42',
          fakeReq,
        ),
      ).rejects.toThrow(ValidationError);

      expect(mockedRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('update()', () => {
    it('emits sponsor_invoice.updated and sponsor_invoice.status_changed when status flips', async () => {
      const previous = { ...fakeInvoice, status: 'DRAFT' };
      const updated = { ...fakeInvoice, status: 'ISSUED', sentDate: new Date() };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('sinv-1', { status: 'ISSUED' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor_invoice.updated');
      expect(events).toContain('sponsor_invoice.status_changed');

      const statusEvent = findEvent('sponsor_invoice.status_changed') as any;
      expect(statusEvent.data.previousStatus).toBe('DRAFT');
      expect(statusEvent.data.newStatus).toBe('ISSUED');
    });

    it('does NOT emit status_changed when only metadata is updated', async () => {
      const previous = { ...fakeInvoice, notes: 'Old' };
      const updated = { ...fakeInvoice, notes: 'New' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('sinv-1', { notes: 'New' } as any, 'user-42', fakeReq);

      const events = mockedEmitEvent.mock.calls.map((c) =>
        typeof c[0] === 'object' ? (c[0] as { event: string }).event : c[0],
      );
      expect(events).toContain('sponsor_invoice.updated');
      expect(events).not.toContain('sponsor_invoice.status_changed');
    });

    it('throws NotFoundError when updating a missing invoice', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: 'PAID' } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });

    it('emits paidAmount in the updated payload with Decimal-as-string compat', async () => {
      const previous = { ...fakeInvoice, paidAmount: '0' };
      const updated = { ...fakeInvoice, paidAmount: '5000', status: 'PARTIALLY_PAID' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update(
        'sinv-1',
        { paidAmount: 5000, status: 'PARTIALLY_PAID' } as any,
        'user-42',
        fakeReq,
      );

      const updatedEvent = findEvent('sponsor_invoice.updated') as any;
      expect(updatedEvent.data.paidAmount).toBe(5000);
      expect(updatedEvent.data.amount).toBe(12000);
    });
  });

  describe('remove()', () => {
    it('soft-deletes via repo.softDelete, audits, and emits sponsor_invoice.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeInvoice as any);
      mockedRepo.softDelete.mockResolvedValue(fakeInvoice as any);

      await service.remove('sinv-1', 'user-42', fakeReq);

      expect(mockedRepo.softDelete).toHaveBeenCalledWith('sinv-1');
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'SponsorInvoice',
        'sinv-1',
        'DELETE',
        'user-42',
        fakeInvoice,
        null,
        fakeReq,
      );
      const event = findEvent('sponsor_invoice.deleted');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        sponsorId: 'spn-1',
        invoiceNumber: 'SINV-2025-001',
        academicYear: '2025/26',
      });
    });

    it('throws NotFoundError if the invoice does not exist before deletion', async () => {
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
        sort: 'issueDate',
        order: 'desc',
        sponsorId: 'spn-1',
        academicYear: '2025/26',
        status: 'ISSUED',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          sponsorId: 'spn-1',
          academicYear: '2025/26',
          status: 'ISSUED',
        }),
        expect.objectContaining({ cursor: undefined, limit: 25, sort: 'issueDate', order: 'desc' }),
      );
    });
  });
});
