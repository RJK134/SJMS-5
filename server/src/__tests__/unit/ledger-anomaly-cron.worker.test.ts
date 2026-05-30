/**
 * Phase 1E — ledger-anomaly cron worker unit tests.
 *
 * Covers the worker file's run/lastRun/register/trigger seams. Mocks the
 * BullMQ queue helpers and the scan service so the test never touches
 * Redis or Prisma.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addMock = vi.fn();
vi.mock('../../utils/queue', () => ({
  createWorker: vi.fn(),
  getQueue: vi.fn(() => ({ add: addMock })),
}));
vi.mock('../../api/ledger-anomalies/ledger-anomalies.service', () => ({
  scanLedgerAnomalies: vi.fn(),
}));

import * as worker from '../../workers/ledger-anomaly-cron.worker';
import { createWorker, getQueue } from '../../utils/queue';
import { scanLedgerAnomalies } from '../../api/ledger-anomalies/ledger-anomalies.service';

const mockedCreateWorker = vi.mocked(createWorker);
const mockedGetQueue = vi.mocked(getQueue);
const mockedScan = vi.mocked(scanLedgerAnomalies);

const ENABLE_ENV = 'SJMS_ENABLE_LEDGER_ANOMALY_CRON';
const PATTERN_ENV = 'SJMS_LEDGER_ANOMALY_CRON_PATTERN';

function fakeReport(overrides: Partial<{ total: number; hasHighSeverity: boolean }> = {}) {
  return {
    anomalies: [],
    counts: { NEGATIVE_BALANCE: 0, ORPHAN_CHARGE_LINE: 0, DUPLICATE_INVOICE_NUMBER: 0 },
    severityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    total: overrides.total ?? 0,
    hasHighSeverity: overrides.hasHighSeverity ?? false,
    effectiveRules: { negativeBalanceHighThreshold: 1000 },
    scanId: 'ledger-scan-123',
    scannedAt: new Date().toISOString(),
  };
}

describe('ledger-anomaly-cron.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addMock.mockReset();
    worker.__resetLastLedgerAnomalyCronRunForTests();
    delete process.env[ENABLE_ENV];
    delete process.env[PATTERN_ENV];
  });

  afterEach(() => {
    delete process.env[ENABLE_ENV];
    delete process.env[PATTERN_ENV];
  });

  describe('__runOnceForTests', () => {
    it('records an ok run with the report summary (cron trigger)', async () => {
      mockedScan.mockResolvedValue(fakeReport({ total: 3, hasHighSeverity: true }) as any);

      const run = await worker.__runOnceForTests('cron');

      expect(run.status).toBe('ok');
      expect(run.trigger).toBe('cron');
      expect(run.total).toBe(3);
      expect(run.hasHighSeverity).toBe(true);
      expect(run.errorMessage).toBeUndefined();
      expect(worker.getLastLedgerAnomalyCronRun()).toEqual(run);

      // The cron actor id is passed to the scan service, no req.
      expect(mockedScan).toHaveBeenCalledWith({}, 'system:ledger-anomaly-cron');
    });

    it('tags a manual trigger', async () => {
      mockedScan.mockResolvedValue(fakeReport() as any);
      const run = await worker.__runOnceForTests('manual');
      expect(run.trigger).toBe('manual');
    });

    it('records an error run and rethrows when the scan throws', async () => {
      mockedScan.mockRejectedValue(new Error('scan boom'));

      await expect(worker.__runOnceForTests('cron')).rejects.toThrow('scan boom');

      const last = worker.getLastLedgerAnomalyCronRun();
      expect(last?.status).toBe('error');
      expect(last?.errorMessage).toBe('scan boom');
      expect(last?.total).toBe(0);
    });
  });

  describe('getLastLedgerAnomalyCronRun', () => {
    it('returns null before any run', () => {
      expect(worker.getLastLedgerAnomalyCronRun()).toBeNull();
    });
  });

  describe('registerLedgerAnomalyCronWorker', () => {
    it('no-ops when the env gate is off', () => {
      worker.registerLedgerAnomalyCronWorker();
      expect(mockedCreateWorker).not.toHaveBeenCalled();
      expect(mockedGetQueue).not.toHaveBeenCalled();
    });

    it('registers the worker + repeatable cron when enabled', () => {
      process.env[ENABLE_ENV] = 'true';
      worker.registerLedgerAnomalyCronWorker();

      expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
      expect(mockedCreateWorker.mock.calls[0][0]).toBe(worker.LEDGER_ANOMALY_CRON_QUEUE);
      expect(mockedGetQueue).toHaveBeenCalledWith(worker.LEDGER_ANOMALY_CRON_QUEUE);

      // Repeatable job scheduled with the default pattern.
      expect(addMock).toHaveBeenCalledTimes(1);
      const [jobName, , opts] = addMock.mock.calls[0];
      expect(jobName).toBe(worker.LEDGER_ANOMALY_CRON_JOB);
      expect(opts.repeat.pattern).toBe(worker.LEDGER_ANOMALY_CRON_DEFAULT_PATTERN);
    });

    it('honours a cron-pattern override', () => {
      process.env[ENABLE_ENV] = 'true';
      process.env[PATTERN_ENV] = '0 4 * * *';
      worker.registerLedgerAnomalyCronWorker();

      const [, , opts] = addMock.mock.calls[0];
      expect(opts.repeat.pattern).toBe('0 4 * * *');
    });

    it('treats a non-"true" gate value as disabled', () => {
      process.env[ENABLE_ENV] = 'yes';
      worker.registerLedgerAnomalyCronWorker();
      expect(mockedCreateWorker).not.toHaveBeenCalled();
    });
  });

  describe('triggerScanNow', () => {
    it('enqueues a manual one-off and returns the job id', async () => {
      addMock.mockResolvedValue({ id: 'job-9' });
      const id = await worker.triggerScanNow();
      expect(id).toBe('job-9');
      const [jobName] = addMock.mock.calls[0];
      expect(jobName).toBe(worker.LEDGER_ANOMALY_CRON_JOB_MANUAL);
    });

    it('returns null when enqueue throws (Redis unavailable)', async () => {
      addMock.mockRejectedValue(new Error('no redis'));
      const id = await worker.triggerScanNow();
      expect(id).toBeNull();
    });
  });
});
