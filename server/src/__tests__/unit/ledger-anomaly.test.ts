import { describe, it, expect } from 'vitest';
import {
  classifyLedgerAnomalies,
  type LedgerAnomalyInput,
} from '../../utils/ledger-anomaly';

function input(overrides: Partial<LedgerAnomalyInput> = {}): LedgerAnomalyInput {
  return {
    negativeBalances: [],
    orphanChargeLines: [],
    duplicateInvoiceNumbers: [],
    ...overrides,
  };
}

describe('utils/ledger-anomaly — classifyLedgerAnomalies', () => {
  describe('empty input', () => {
    it('returns a clean, zeroed report', () => {
      const r = classifyLedgerAnomalies(input());
      expect(r.total).toBe(0);
      expect(r.anomalies).toEqual([]);
      expect(r.hasHighSeverity).toBe(false);
      expect(r.counts).toEqual({
        NEGATIVE_BALANCE: 0,
        ORPHAN_CHARGE_LINE: 0,
        DUPLICATE_INVOICE_NUMBER: 0,
      });
      expect(r.severityCounts).toEqual({ HIGH: 0, MEDIUM: 0, LOW: 0 });
    });

    it('still reports effectiveRules (default threshold)', () => {
      const r = classifyLedgerAnomalies(input());
      expect(r.effectiveRules.negativeBalanceHighThreshold).toBe(1000);
    });
  });

  describe('negative balances', () => {
    it('classifies a small negative balance as MEDIUM', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-1', studentId: 'stu-1', academicYear: '2025/26', balance: -50 },
          ],
        }),
      );
      expect(r.total).toBe(1);
      expect(r.anomalies[0].type).toBe('NEGATIVE_BALANCE');
      expect(r.anomalies[0].severity).toBe('MEDIUM');
      expect(r.anomalies[0].entityId).toBe('acc-1');
      expect(r.anomalies[0].data.balance).toBe(-50);
      expect(r.hasHighSeverity).toBe(false);
    });

    it('escalates a balance at/beyond the HIGH threshold to HIGH', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-2', studentId: 'stu-2', academicYear: '2025/26', balance: -1000 },
          ],
        }),
      );
      expect(r.anomalies[0].severity).toBe('HIGH');
      expect(r.hasHighSeverity).toBe(true);
    });

    it('honours a custom negativeBalanceHighThreshold', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-3', studentId: 'stu-3', academicYear: '2025/26', balance: -200 },
          ],
          rules: { negativeBalanceHighThreshold: 100 },
        }),
      );
      expect(r.anomalies[0].severity).toBe('HIGH');
      expect(r.effectiveRules.negativeBalanceHighThreshold).toBe(100);
    });

    it('falls back to the default threshold on a non-finite / negative override', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-4', studentId: 'stu-4', academicYear: '2025/26', balance: -500 },
          ],
          rules: { negativeBalanceHighThreshold: -1 },
        }),
      );
      // -1 is invalid → default 1000 → -500 magnitude is below → MEDIUM
      expect(r.anomalies[0].severity).toBe('MEDIUM');
      expect(r.effectiveRules.negativeBalanceHighThreshold).toBe(1000);
    });

    it('rounds the balance to 2 decimal places in the output', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-5', studentId: 'stu-5', academicYear: '2025/26', balance: -12.006 },
          ],
        }),
      );
      // round2(-12.006) = Math.round(-1200.6)/100 = -12.01
      expect(r.anomalies[0].data.balance).toBe(-12.01);
    });
  });

  describe('orphan charge lines', () => {
    it('classifies a soft-deleted-invoice orphan as MEDIUM', () => {
      const r = classifyLedgerAnomalies(
        input({
          orphanChargeLines: [
            {
              id: 'cl-1',
              studentAccountId: 'acc-1',
              invoiceId: 'inv-1',
              amount: 100,
              reason: 'INVOICE_SOFT_DELETED',
            },
          ],
        }),
      );
      expect(r.anomalies[0].type).toBe('ORPHAN_CHARGE_LINE');
      expect(r.anomalies[0].severity).toBe('MEDIUM');
      expect(r.anomalies[0].data.reason).toBe('INVOICE_SOFT_DELETED');
      expect(r.anomalies[0].detail).toContain('soft-deleted invoice inv-1');
      expect(r.hasHighSeverity).toBe(false);
    });

    it('classifies a cross-account orphan as HIGH and surfaces both accounts', () => {
      const r = classifyLedgerAnomalies(
        input({
          orphanChargeLines: [
            {
              id: 'cl-2',
              studentAccountId: 'acc-A',
              invoiceId: 'inv-2',
              amount: 250,
              reason: 'ACCOUNT_MISMATCH',
              invoiceStudentAccountId: 'acc-B',
            },
          ],
        }),
      );
      expect(r.anomalies[0].severity).toBe('HIGH');
      expect(r.anomalies[0].data.invoiceStudentAccountId).toBe('acc-B');
      expect(r.anomalies[0].detail).toContain('different account');
      expect(r.hasHighSeverity).toBe(true);
    });

    it('defaults invoiceStudentAccountId to null for a soft-deleted orphan', () => {
      const r = classifyLedgerAnomalies(
        input({
          orphanChargeLines: [
            {
              id: 'cl-3',
              studentAccountId: 'acc-1',
              invoiceId: 'inv-3',
              amount: 10,
              reason: 'INVOICE_SOFT_DELETED',
            },
          ],
        }),
      );
      expect(r.anomalies[0].data.invoiceStudentAccountId).toBeNull();
    });
  });

  describe('duplicate invoice numbers', () => {
    it('classifies a duplicate invoice number as HIGH with all colliding ids', () => {
      const r = classifyLedgerAnomalies(
        input({
          duplicateInvoiceNumbers: [
            { invoiceNumber: 'INV-2025-001', count: 2, invoiceIds: ['inv-a', 'inv-b'] },
          ],
        }),
      );
      expect(r.anomalies[0].type).toBe('DUPLICATE_INVOICE_NUMBER');
      expect(r.anomalies[0].severity).toBe('HIGH');
      expect(r.anomalies[0].entityId).toBe('INV-2025-001');
      expect(r.anomalies[0].data.count).toBe(2);
      expect(r.anomalies[0].data.invoiceIds).toEqual(['inv-a', 'inv-b']);
      expect(r.hasHighSeverity).toBe(true);
    });
  });

  describe('aggregation across types', () => {
    it('counts per type and per severity correctly in a mixed batch', () => {
      const r = classifyLedgerAnomalies(
        input({
          negativeBalances: [
            { id: 'acc-1', studentId: 's1', academicYear: '2025/26', balance: -50 }, // MEDIUM
            { id: 'acc-2', studentId: 's2', academicYear: '2025/26', balance: -5000 }, // HIGH
          ],
          orphanChargeLines: [
            { id: 'cl-1', studentAccountId: 'acc-1', invoiceId: 'inv-1', amount: 1, reason: 'INVOICE_SOFT_DELETED' }, // MEDIUM
            { id: 'cl-2', studentAccountId: 'acc-3', invoiceId: 'inv-2', amount: 2, reason: 'ACCOUNT_MISMATCH', invoiceStudentAccountId: 'acc-9' }, // HIGH
          ],
          duplicateInvoiceNumbers: [
            { invoiceNumber: 'INV-X', count: 3, invoiceIds: ['a', 'b', 'c'] }, // HIGH
          ],
        }),
      );
      expect(r.total).toBe(5);
      expect(r.counts).toEqual({
        NEGATIVE_BALANCE: 2,
        ORPHAN_CHARGE_LINE: 2,
        DUPLICATE_INVOICE_NUMBER: 1,
      });
      expect(r.severityCounts).toEqual({ HIGH: 3, MEDIUM: 2, LOW: 0 });
      expect(r.hasHighSeverity).toBe(true);
    });
  });

  describe('purity', () => {
    it('does not mutate its input', () => {
      const inp = input({
        duplicateInvoiceNumbers: [
          { invoiceNumber: 'INV-Y', count: 2, invoiceIds: ['a', 'b'] },
        ],
      });
      const snapshot = JSON.stringify(inp);
      classifyLedgerAnomalies(inp);
      expect(JSON.stringify(inp)).toBe(snapshot);
    });

    it('is deterministic for the same input', () => {
      const inp = input({
        negativeBalances: [{ id: 'a', studentId: 's', academicYear: '2025/26', balance: -10 }],
      });
      expect(classifyLedgerAnomalies(inp)).toEqual(classifyLedgerAnomalies(inp));
    });

    it('copies invoiceIds rather than aliasing the input array', () => {
      const ids = ['a', 'b'];
      const r = classifyLedgerAnomalies(
        input({ duplicateInvoiceNumbers: [{ invoiceNumber: 'INV-Z', count: 2, invoiceIds: ids }] }),
      );
      expect(r.anomalies[0].data.invoiceIds).not.toBe(ids);
      expect(r.anomalies[0].data.invoiceIds).toEqual(ids);
    });
  });
});
