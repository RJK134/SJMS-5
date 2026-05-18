import { describe, it, expect } from 'vitest';
import {
  composeInvoiceFromAssessment,
  type InvoiceCompositionInput,
} from '../../utils/invoice-composition';

const baseInput = (
  overrides: Partial<InvoiceCompositionInput> = {},
): InvoiceCompositionInput => ({
  feeAssessment: {
    id: 'fa_aaaa1111bbbb2222',
    enrolmentId: 'enrol-1',
    totalFee: 9240,
    discountAmount: 0,
    finalFee: 9240,
  },
  studentAccount: {
    id: 'acct_zzzz9999yyyy8888',
    studentId: 'stu-1',
    academicYear: '2025/26',
  },
  enrolment: {
    yearOfStudy: 1,
    programme: { title: 'BSc Test', programmeCode: 'TEST123' },
  },
  issueDate: new Date('2025-09-01T00:00:00.000Z'),
  ...overrides,
});

describe('composeInvoiceFromAssessment', () => {
  it('produces a single TUITION line for the finalFee with default rules', () => {
    const result = composeInvoiceFromAssessment(baseInput());
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].chargeType).toBe('TUITION');
    expect(result.lines[0].amount).toBe(9240);
    expect(result.lines[0].currency).toBe('GBP');
    expect(result.lines[0].status).toBe('PENDING');
    expect(result.totalAmount).toBe(9240);
    expect(result.status).toBe('DRAFT');
  });

  it('uses finalFee (not totalFee) for the line amount when a discount is applied', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        feeAssessment: {
          id: 'fa_aaaa1111bbbb2222',
          enrolmentId: 'enrol-1',
          totalFee: 9240,
          discountAmount: 1000,
          finalFee: 8240,
        },
      }),
    );
    expect(result.totalAmount).toBe(8240);
    expect(result.lines[0].amount).toBe(8240);
    expect(result.notes.some((n) => n.includes('Bursary/sponsor discount'))).toBe(true);
    expect(result.notes.some((n) => n.includes('1000.00'))).toBe(true);
  });

  it('emits a deterministic invoice number from the academic year and ID suffixes', () => {
    const result = composeInvoiceFromAssessment(baseInput());
    expect(result.invoiceNumber).toBe('INV-2526-YYYY8888-BBBB2222');
  });

  it('honours an explicit invoice number override', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({ invoiceNumberOverride: 'INV-CUSTOM-001' }),
    );
    expect(result.invoiceNumber).toBe('INV-CUSTOM-001');
  });

  it('defaults dueDate to issueDate + 30 days', () => {
    const issueDate = new Date('2025-09-01T00:00:00.000Z');
    const result = composeInvoiceFromAssessment(baseInput({ issueDate }));
    expect(result.dueDate.getTime() - issueDate.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
  });

  it('honours rules.defaultDueDays', () => {
    const issueDate = new Date('2025-09-01T00:00:00.000Z');
    const result = composeInvoiceFromAssessment(
      baseInput({ issueDate, rules: { defaultDueDays: 14 } }),
    );
    expect(result.dueDate.getTime() - issueDate.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });

  it('honours an explicit dueDate override', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        issueDate: new Date('2025-09-01T00:00:00.000Z'),
        dueDate: new Date('2025-12-31T23:59:59.000Z'),
      }),
    );
    expect(result.dueDate.toISOString()).toBe('2025-12-31T23:59:59.000Z');
  });

  it('honours a custom currency code', () => {
    const result = composeInvoiceFromAssessment(baseInput({ currency: 'EUR' }));
    expect(result.lines[0].currency).toBe('EUR');
  });

  it('honours rules.tuitionTaxCode by stamping it on the line', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({ rules: { tuitionTaxCode: 'Z' } }),
    );
    expect(result.lines[0].taxCode).toBe('Z');
    expect(result.effectiveRules.tuitionTaxCode).toBe('Z');
  });

  it('omits taxCode when rules.tuitionTaxCode is not supplied', () => {
    const result = composeInvoiceFromAssessment(baseInput());
    expect(result.lines[0].taxCode).toBeUndefined();
    expect(result.effectiveRules.tuitionTaxCode).toBeNull();
  });

  it('honours rules.tuitionChargeType (e.g. RESIT for resit-only invoices)', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({ rules: { tuitionChargeType: 'RESIT' } }),
    );
    expect(result.lines[0].chargeType).toBe('RESIT');
  });

  it('honours rules.initialStatus + rules.initialLineStatus', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        rules: { initialStatus: 'ISSUED', initialLineStatus: 'INVOICED' },
      }),
    );
    expect(result.status).toBe('ISSUED');
    expect(result.lines[0].status).toBe('INVOICED');
  });

  it('rounds finalFee to 2 decimal places', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        feeAssessment: {
          id: 'fa_aaaa1111bbbb2222',
          enrolmentId: 'enrol-1',
          totalFee: 9240.567,
          discountAmount: 0,
          finalFee: 9240.567,
        },
      }),
    );
    expect(result.totalAmount).toBe(9240.57);
  });

  it('builds a description that includes the academic year, programme, and year of study', () => {
    const result = composeInvoiceFromAssessment(baseInput());
    const description = result.lines[0].description;
    expect(description).toContain('Tuition fee');
    expect(description).toContain('2025/26');
    expect(description).toContain('BSc Test');
    expect(description).toContain('TEST123');
    expect(description).toContain('Year 1');
  });

  it('handles a missing programme block gracefully (no programme info in description)', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({ enrolment: { yearOfStudy: 2 } }),
    );
    expect(result.lines[0].description).toContain('Tuition fee');
    expect(result.lines[0].description).toContain('Year 2');
    // No `—` separator block when no programme info is present.
    expect(result.lines[0].description).not.toContain('—');
  });

  it('records bursary/sponsor references in notes for audit trail', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        feeAssessment: {
          id: 'fa_aaaa1111bbbb2222',
          enrolmentId: 'enrol-1',
          totalFee: 9240,
          discountAmount: 1500,
          finalFee: 7740,
          bursaryReferences: ['burs-1', 'burs-2'],
          sponsorReferences: ['spon-1'],
        },
      }),
    );
    expect(result.notes.some((n) => n.includes('Bursary references: burs-1, burs-2'))).toBe(true);
    expect(result.notes.some((n) => n.includes('Sponsor references: spon-1'))).toBe(true);
  });

  it('flags zero-amount invoices in the notes for record-keeping', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        feeAssessment: {
          id: 'fa_aaaa1111bbbb2222',
          enrolmentId: 'enrol-1',
          totalFee: 9240,
          discountAmount: 9240,
          finalFee: 0,
        },
      }),
    );
    expect(result.totalAmount).toBe(0);
    expect(result.notes.some((n) => n.includes('record-keeping only'))).toBe(true);
  });

  it('captures effectiveRules for audit traceability', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({ rules: { defaultDueDays: 60 } }),
    );
    expect(result.effectiveRules).toEqual({
      defaultDueDays: 60,
      tuitionChargeType: 'TUITION',
      initialStatus: 'DRAFT',
      initialLineStatus: 'PENDING',
      tuitionTaxCode: null,
    });
  });

  it('is deterministic — calling twice with the same input returns identical output', () => {
    const a = composeInvoiceFromAssessment(baseInput());
    const b = composeInvoiceFromAssessment(baseInput());
    expect(a).toEqual(b);
  });

  it('falls back gracefully when academicYear has an unexpected shape', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        studentAccount: { id: 'acct_xxxxx12345678', studentId: 'stu-1', academicYear: '20' },
      }),
    );
    // last 4 digits of "20" are "0020" after pad — confirms the fallback
    expect(result.invoiceNumber).toContain('INV-0020-');
  });

  it('strips empty bursary / sponsor references silently', () => {
    const result = composeInvoiceFromAssessment(
      baseInput({
        feeAssessment: {
          id: 'fa_aaaa1111bbbb2222',
          enrolmentId: 'enrol-1',
          totalFee: 9240,
          discountAmount: 0,
          finalFee: 9240,
          bursaryReferences: ['', 'real-burs', ''],
          sponsorReferences: [],
        },
      }),
    );
    expect(result.notes.some((n) => n.includes('Bursary references: real-burs'))).toBe(true);
    expect(result.notes.some((n) => n.includes('Sponsor references'))).toBe(false);
  });
});
