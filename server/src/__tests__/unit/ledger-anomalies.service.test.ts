import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/ledgerAnomaly.repository', () => ({
  findNegativeBalanceAccounts: vi.fn(),
  findOrphanChargeLines: vi.fn(),
  findDuplicateInvoiceNumbers: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));
vi.mock('../../utils/metrics', () => ({
  recordLedgerAnomalyScan: vi.fn(),
  recordLedgerAnomalyScanFailure: vi.fn(),
}));

import * as service from '../../api/ledger-anomalies/ledger-anomalies.service';
import * as repo from '../../repositories/ledgerAnomaly.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import {
  recordLedgerAnomalyScan,
  recordLedgerAnomalyScanFailure,
} from '../../utils/metrics';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);
const mockedRecordScan = vi.mocked(recordLedgerAnomalyScan);
const mockedRecordFailure = vi.mocked(recordLedgerAnomalyScanFailure);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const eventsOfType = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? (c[0] as { event?: string; data?: any }) : null))
    .filter((e): e is { event: string; data: any } => !!e && e.event === eventName);

describe('ledger-anomalies.service — scanLedgerAnomalies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.findNegativeBalanceAccounts.mockResolvedValue([]);
    mockedRepo.findOrphanChargeLines.mockResolvedValue([]);
    mockedRepo.findDuplicateInvoiceNumbers.mockResolvedValue([]);
  });

  it('clean ledger: total 0, records metrics, emits scan_completed, no per-anomaly events', async () => {
    const result = await service.scanLedgerAnomalies({}, 'user-1', fakeReq);

    expect(result.total).toBe(0);
    expect(result.hasHighSeverity).toBe(false);
    expect(result.scanId).toMatch(/^ledger-scan-/);
    expect(typeof result.scannedAt).toBe('string');

    expect(mockedRecordScan).toHaveBeenCalledTimes(1);
    expect(mockedRecordFailure).not.toHaveBeenCalled();

    expect(eventsOfType('ledger.anomaly_scan_completed')).toHaveLength(1);
    expect(eventsOfType('ledger.anomaly_detected')).toHaveLength(0);
  });

  it('audits the scan as a VIEW on a LedgerAnomalyScan subject', async () => {
    await service.scanLedgerAnomalies({}, 'user-7', fakeReq);

    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    const call = mockedLogAudit.mock.calls[0];
    expect(call[0]).toBe('LedgerAnomalyScan');
    expect(call[1]).toMatch(/^ledger-scan-/); // entityId
    expect(call[2]).toBe('VIEW'); // action
    expect(call[3]).toBe('user-7'); // userId
    const newData = call[5] as Record<string, unknown>;
    expect(newData).toHaveProperty('total');
    expect(newData).toHaveProperty('severityCounts');
  });

  it('emits one ledger.anomaly_detected per anomaly with type + severity + detail', async () => {
    mockedRepo.findNegativeBalanceAccounts.mockResolvedValue([
      { id: 'acc-1', studentId: 's1', academicYear: '2025/26', balance: -5000 },
    ]);
    mockedRepo.findDuplicateInvoiceNumbers.mockResolvedValue([
      { invoiceNumber: 'INV-1', count: 2, invoiceIds: ['a', 'b'] },
    ]);

    const result = await service.scanLedgerAnomalies({}, 'user-1', fakeReq);

    expect(result.total).toBe(2);
    expect(result.hasHighSeverity).toBe(true);

    const detected = eventsOfType('ledger.anomaly_detected');
    expect(detected).toHaveLength(2);
    const types = detected.map((e) => e.data.type).sort();
    expect(types).toEqual(['DUPLICATE_INVOICE_NUMBER', 'NEGATIVE_BALANCE']);
    for (const e of detected) {
      expect(e.data).toHaveProperty('severity');
      expect(e.data).toHaveProperty('detail');
      expect(e.data.scanId).toBe(result.scanId);
    }
  });

  it('passes negativeBalanceHighThreshold through to the classifier', async () => {
    mockedRepo.findNegativeBalanceAccounts.mockResolvedValue([
      { id: 'acc-1', studentId: 's1', academicYear: '2025/26', balance: -200 },
    ]);

    // Default threshold (1000) → MEDIUM
    const def = await service.scanLedgerAnomalies({}, 'user-1', fakeReq);
    expect(def.severityCounts.HIGH).toBe(0);
    expect(def.severityCounts.MEDIUM).toBe(1);

    // Lowered threshold (100) → HIGH
    const lowered = await service.scanLedgerAnomalies(
      { negativeBalanceHighThreshold: 100 },
      'user-1',
      fakeReq,
    );
    expect(lowered.severityCounts.HIGH).toBe(1);
    expect(lowered.effectiveRules.negativeBalanceHighThreshold).toBe(100);
  });

  it('passes the limit option through to every repository query', async () => {
    await service.scanLedgerAnomalies({ limit: 42 }, 'user-1', fakeReq);
    expect(mockedRepo.findNegativeBalanceAccounts).toHaveBeenCalledWith(42);
    expect(mockedRepo.findOrphanChargeLines).toHaveBeenCalledWith(42);
    expect(mockedRepo.findDuplicateInvoiceNumbers).toHaveBeenCalledWith(42);
  });

  it('records a failure metric and rethrows when a query throws', async () => {
    mockedRepo.findOrphanChargeLines.mockRejectedValue(new Error('db down'));

    await expect(service.scanLedgerAnomalies({}, 'user-1', fakeReq)).rejects.toThrow('db down');

    expect(mockedRecordFailure).toHaveBeenCalledTimes(1);
    expect(mockedRecordScan).not.toHaveBeenCalled();
    // No success events / audit on the failure path.
    expect(eventsOfType('ledger.anomaly_scan_completed')).toHaveLength(0);
    expect(mockedLogAudit).not.toHaveBeenCalled();
  });

  it('builds the metric map from the classified report (type|severity counts)', async () => {
    mockedRepo.findOrphanChargeLines.mockResolvedValue([
      { id: 'cl-1', studentAccountId: 'a', invoiceId: 'i1', amount: 1, reason: 'INVOICE_SOFT_DELETED' },
      { id: 'cl-2', studentAccountId: 'a', invoiceId: 'i2', amount: 2, reason: 'ACCOUNT_MISMATCH', invoiceStudentAccountId: 'b' },
    ]);

    await service.scanLedgerAnomalies({}, 'user-1', fakeReq);

    const metricMap = mockedRecordScan.mock.calls[0][0];
    expect(metricMap['ORPHAN_CHARGE_LINE|MEDIUM']).toBe(1);
    expect(metricMap['ORPHAN_CHARGE_LINE|HIGH']).toBe(1);
  });

  it('works without a req object (cron path)', async () => {
    const result = await service.scanLedgerAnomalies({}, 'system:ledger-anomaly-cron');
    expect(result.total).toBe(0);
    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    // logAudit called with req === undefined
    expect(mockedLogAudit.mock.calls[0][6]).toBeUndefined();
  });
});
