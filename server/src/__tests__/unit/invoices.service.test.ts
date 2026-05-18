import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/invoice.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  findByInvoiceNumber: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  createWithLines: vi.fn(),
}));
vi.mock('../../repositories/feeAssessment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/finance.repository', () => ({
  list: vi.fn(),
  findByStudentAndYear: vi.fn(),
}));
vi.mock('../../repositories/enrolment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as invoicesService from '../../api/invoices/invoices.service';
import * as repo from '../../repositories/invoice.repository';
import * as feeAssessmentRepo from '../../repositories/feeAssessment.repository';
import * as financeRepo from '../../repositories/finance.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedFeeAssessmentRepo = vi.mocked(feeAssessmentRepo);
const mockedFinanceRepo = vi.mocked(financeRepo);
const mockedEnrolmentRepo = vi.mocked(enrolmentRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeFeeAssessment = {
  id: 'fa_aaaa1111bbbb2222',
  enrolmentId: 'enrol-1',
  feeStatus: 'HOME',
  totalFee: 9240,
  discountAmount: 0,
  finalFee: 9240,
};

const fakeEnrolment = {
  id: 'enrol-1',
  studentId: 'stu-1',
  academicYear: '2025/26',
  yearOfStudy: 1,
  programme: { title: 'BSc Test', programmeCode: 'TEST123' },
};

const fakeAccount = {
  id: 'acct_zzzz9999yyyy8888',
  studentId: 'stu-1',
  academicYear: '2025/26',
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('invoicesService.generateForFeeAssessment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedFeeAssessmentRepo.getById.mockResolvedValue(fakeFeeAssessment as any);
    mockedEnrolmentRepo.getById.mockResolvedValue(fakeEnrolment as any);
    mockedFinanceRepo.findByStudentAndYear.mockResolvedValue(fakeAccount as any);
    mockedRepo.findByInvoiceNumber.mockResolvedValue(null);
  });

  it('throws NotFoundError when the FeeAssessment does not exist', async () => {
    mockedFeeAssessmentRepo.getById.mockResolvedValue(null);
    await expect(
      invoicesService.generateForFeeAssessment('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the linked enrolment does not exist', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue(null);
    await expect(
      invoicesService.generateForFeeAssessment('fa_aaaa1111bbbb2222', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when no StudentAccount exists for (studentId, academicYear)', async () => {
    mockedFinanceRepo.findByStudentAndYear.mockResolvedValue(null);
    await expect(
      invoicesService.generateForFeeAssessment('fa_aaaa1111bbbb2222', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when an explicit studentAccountId does not match the enrolment', async () => {
    mockedFinanceRepo.list.mockResolvedValue({ data: [] } as any);
    await expect(
      invoicesService.generateForFeeAssessment(
        'fa_aaaa1111bbbb2222',
        { studentAccountId: 'acct_does-not-exist' },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('returns a preview composition without persisting', async () => {
    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      {},
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.invoiceId).toBeNull();
    expect(result.totalAmount).toBe(9240);
    expect(result.invoiceNumber).toBe('INV-2526-YYYY8888-BBBB2222');
    expect(mockedRepo.createWithLines).not.toHaveBeenCalled();

    const generated = findEvent('invoice.generated');
    expect(generated).toBeDefined();
    expect(generated?.data).toEqual(
      expect.objectContaining({
        feeAssessmentId: 'fa_aaaa1111bbbb2222',
        studentAccountId: 'acct_zzzz9999yyyy8888',
        invoiceNumber: 'INV-2526-YYYY8888-BBBB2222',
        totalAmount: 9240,
        persisted: false,
        skipped: false,
      }),
    );
  });

  it('persist:true creates a new Invoice + ChargeLine atomically and emits invoice.created + invoice.generated', async () => {
    mockedRepo.createWithLines.mockResolvedValue({
      id: 'inv-new',
      studentAccountId: 'acct_zzzz9999yyyy8888',
      invoiceNumber: 'INV-2526-YYYY8888-BBBB2222',
      totalAmount: 9240,
      status: 'DRAFT',
    } as any);

    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.invoiceId).toBe('inv-new');
    expect(mockedRepo.createWithLines).toHaveBeenCalledTimes(1);
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'Invoice',
      'inv-new',
      'CREATE',
      'user-1',
      null,
      expect.any(Object),
      fakeReq,
    );

    expect(findEvent('invoice.created')).toBeDefined();
    expect(findEvent('invoice.generated')).toBeDefined();
  });

  it('persist:true is idempotent — returns existing invoice with skipped:true when invoiceNumber already exists', async () => {
    mockedRepo.findByInvoiceNumber.mockResolvedValue({
      id: 'inv-existing',
      invoiceNumber: 'INV-2526-YYYY8888-BBBB2222',
    } as any);

    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.invoiceId).toBe('inv-existing');
    expect(mockedRepo.createWithLines).not.toHaveBeenCalled();

    const generated = findEvent('invoice.generated');
    expect(generated?.data).toEqual(
      expect.objectContaining({ persisted: false, skipped: true }),
    );
  });

  it('force:true bypasses idempotency and creates a -R1 suffixed replacement invoice', async () => {
    mockedRepo.findByInvoiceNumber
      .mockResolvedValueOnce({
        id: 'inv-existing',
        invoiceNumber: 'INV-2526-YYYY8888-BBBB2222',
      } as any)
      .mockResolvedValueOnce(null); // -R1 slot is free
    mockedRepo.createWithLines.mockResolvedValue({
      id: 'inv-replacement',
      studentAccountId: 'acct_zzzz9999yyyy8888',
      invoiceNumber: 'INV-2526-YYYY8888-BBBB2222-R1',
      totalAmount: 9240,
      status: 'DRAFT',
    } as any);

    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      { persist: true, force: true },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.invoiceNumber).toBe('INV-2526-YYYY8888-BBBB2222-R1');
    expect(result.invoiceId).toBe('inv-replacement');

    const generated = findEvent('invoice.generated');
    expect(generated?.data).toEqual(
      expect.objectContaining({ force: true }),
    );
  });

  it('forwards rule overrides to the pure utility (defaultDueDays + tuitionTaxCode)', async () => {
    const issueDate = new Date('2025-09-01T00:00:00.000Z');
    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      {
        issueDate,
        rules: { defaultDueDays: 14, tuitionTaxCode: 'Z' },
      },
      'user-1',
      fakeReq,
    );

    expect(result.dueDate.getTime() - issueDate.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    expect(result.lines[0].taxCode).toBe('Z');
  });

  it('honours an explicit invoiceNumber override on the action endpoint', async () => {
    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      { invoiceNumber: 'INV-MANUAL-001' },
      'user-1',
      fakeReq,
    );
    expect(result.invoiceNumber).toBe('INV-MANUAL-001');
  });

  it('handles a Decimal-string totalFee from the Prisma client (toString → number)', async () => {
    mockedFeeAssessmentRepo.getById.mockResolvedValue({
      ...fakeFeeAssessment,
      totalFee: { toString: () => '9240.00' } as any,
      finalFee: { toString: () => '9240.00' } as any,
      discountAmount: { toString: () => '0' } as any,
    } as any);

    const result = await invoicesService.generateForFeeAssessment(
      'fa_aaaa1111bbbb2222',
      {},
      'user-1',
      fakeReq,
    );
    expect(result.totalAmount).toBe(9240);
  });
});

describe('invoicesService CRUD', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('getById throws NotFoundError when the invoice is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(invoicesService.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('create throws ValidationError directing the caller to use the generate endpoint', async () => {
    await expect(invoicesService.create({} as any, 'user-1', fakeReq)).rejects.toThrow(ValidationError);
    expect(mockedRepo.create).not.toHaveBeenCalled();
  });

  it('update emits invoice.status_changed when the status moves', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inv-1',
      studentAccountId: 'acct_z',
      invoiceNumber: 'INV-001',
      paidAmount: 0,
      status: 'DRAFT',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'inv-1',
      studentAccountId: 'acct_z',
      invoiceNumber: 'INV-001',
      paidAmount: 0,
      status: 'ISSUED',
    } as any);

    await invoicesService.update('inv-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('invoice.updated')).toBeDefined();
    const statusChanged = findEvent('invoice.status_changed');
    expect(statusChanged).toBeDefined();
    expect(statusChanged?.data).toEqual(
      expect.objectContaining({ previousStatus: 'DRAFT', newStatus: 'ISSUED' }),
    );
  });

  it('update does NOT emit invoice.status_changed when the status is unchanged', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inv-1',
      studentAccountId: 'acct_z',
      invoiceNumber: 'INV-001',
      paidAmount: 0,
      status: 'DRAFT',
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'inv-1',
      studentAccountId: 'acct_z',
      invoiceNumber: 'INV-001',
      paidAmount: 100,
      status: 'DRAFT',
    } as any);

    await invoicesService.update('inv-1', {} as any, 'user-1', fakeReq);
    expect(findEvent('invoice.updated')).toBeDefined();
    expect(findEvent('invoice.status_changed')).toBeUndefined();
  });

  it('remove soft-deletes through the repo, audits, and emits invoice.deleted', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'inv-1',
      studentAccountId: 'acct_z',
      invoiceNumber: 'INV-001',
      status: 'CANCELLED',
    } as any);

    await invoicesService.remove('inv-1', 'user-1', fakeReq);
    expect(mockedRepo.softDelete).toHaveBeenCalledWith('inv-1');
    expect(findEvent('invoice.deleted')).toBeDefined();
  });
});
