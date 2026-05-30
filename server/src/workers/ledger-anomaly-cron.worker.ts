/**
 * Ledger-anomaly cron worker (Phase 1E).
 *
 * Daily BullMQ schedule that calls
 * `ledgerAnomaliesService.scanLedgerAnomalies(...)` to sweep the finance
 * ledger for the three anomaly classes (negative StudentAccount balances,
 * orphan ChargeLines, duplicate invoice numbers). The scan is read-only:
 * it updates the Prometheus gauges, emits `ledger.anomaly_scan_completed`
 * + per-anomaly `ledger.anomaly_detected` events, and writes an audit row.
 * Remediation stays a deliberate operator action.
 *
 * Mirrors the Phase 1A payment-instalment cron exactly:
 *
 * **Gating**: registration is opt-in via
 * `SJMS_ENABLE_LEDGER_ANOMALY_CRON=true`. Dev, test, and any Vercel API
 * process never connect to Redis or enqueue cron rows. Only the
 * long-running worker process on Railway / Render / Fly (per
 * docs/architecture/outbox-worker-hosting.md) sets the flag, so
 * registration is idempotent and one-per-process.
 *
 * **Schedule**: daily at 03:00 UTC. A quiet pre-dawn UK slot, after the
 * 02:30 payment-instalment cron so the ledger reflects any ChargeLines
 * that run issued, and before the 06:00 dataset snapshot. Override via
 * `SJMS_LEDGER_ANOMALY_CRON_PATTERN`.
 *
 * **Operator on-demand**: `triggerScanNow()` enqueues a one-off
 * `manual-ledger-anomaly-cron` job that the same worker picks up
 * identically. Surfaces via `getLastLedgerAnomalyCronRun()` for
 * `/health`-style consumers. (The synchronous `POST
 * /v1/ledger-anomalies/scan` endpoint is the request-path equivalent.)
 */

import logger from '../utils/logger';
import { createWorker, getQueue } from '../utils/queue';
import { scanLedgerAnomalies } from '../api/ledger-anomalies/ledger-anomalies.service';

/** Queue carrying the daily cron and operator-triggered one-offs. */
export const LEDGER_ANOMALY_CRON_QUEUE = 'ledger-anomaly-cron';
/** Job name attached to the daily cron schedule. */
export const LEDGER_ANOMALY_CRON_JOB = 'daily-ledger-anomaly-cron';
/** Job name attached to operator one-offs. */
export const LEDGER_ANOMALY_CRON_JOB_MANUAL = 'manual-ledger-anomaly-cron';
/** Default cron pattern — daily at 03:00 UTC. */
export const LEDGER_ANOMALY_CRON_DEFAULT_PATTERN = '0 3 * * *';
/** Env-gate the registration so non-worker processes never touch Redis. */
export const LEDGER_ANOMALY_CRON_ENABLE_ENV = 'SJMS_ENABLE_LEDGER_ANOMALY_CRON' as const;
/** Override the cron pattern at deploy time without code changes. */
export const LEDGER_ANOMALY_CRON_PATTERN_ENV = 'SJMS_LEDGER_ANOMALY_CRON_PATTERN' as const;
/** Actor id recorded on cron-driven scans (vs an authenticated user sub). */
export const LEDGER_ANOMALY_CRON_ACTOR = 'system:ledger-anomaly-cron' as const;

export interface LedgerAnomalyCronLastRun {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  trigger: 'cron' | 'manual';
  /** Total anomalies found by the run. */
  total: number;
  /** True when at least one HIGH-severity anomaly was found. */
  hasHighSeverity: boolean;
  /** Per-type counts (NEGATIVE_BALANCE / ORPHAN_CHARGE_LINE / DUPLICATE_INVOICE_NUMBER). */
  counts: Record<string, number>;
  /** Captured error message when the job itself threw. */
  errorMessage?: string;
}

let lastRun: LedgerAnomalyCronLastRun | null = null;

/** Last-run accessor for `/health` and operator dashboards. */
export function getLastLedgerAnomalyCronRun(): LedgerAnomalyCronLastRun | null {
  return lastRun;
}

/** Test-only hook — reset the in-process cache between cases. */
export function __resetLastLedgerAnomalyCronRunForTests(): void {
  lastRun = null;
}

function resolveCronPattern(): string {
  return (
    process.env[LEDGER_ANOMALY_CRON_PATTERN_ENV]?.trim() ||
    LEDGER_ANOMALY_CRON_DEFAULT_PATTERN
  );
}

function isEnabled(): boolean {
  return process.env[LEDGER_ANOMALY_CRON_ENABLE_ENV]?.trim().toLowerCase() === 'true';
}

/**
 * Worker job handler. Calls the scan service, records the outcome in
 * `lastRun`, and lets BullMQ retry per the queue's defaultJobOptions if
 * the call throws.
 */
async function runOnce(trigger: 'cron' | 'manual'): Promise<LedgerAnomalyCronLastRun> {
  const startedAt = new Date();
  try {
    const report = await scanLedgerAnomalies({}, LEDGER_ANOMALY_CRON_ACTOR);
    const completedAt = new Date();
    const run: LedgerAnomalyCronLastRun = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: 'ok',
      trigger,
      total: report.total,
      hasHighSeverity: report.hasHighSeverity,
      counts: report.counts,
    };
    lastRun = run;
    logger.info(
      `[worker:ledger-anomaly-cron] ${trigger}: ${report.total} anomalies ` +
        `(HIGH=${report.severityCounts.HIGH}, MEDIUM=${report.severityCounts.MEDIUM}) in ${run.durationMs}ms`,
    );
    return run;
  } catch (err) {
    const completedAt = new Date();
    const run: LedgerAnomalyCronLastRun = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: 'error',
      trigger,
      total: 0,
      hasHighSeverity: false,
      counts: {},
      errorMessage: (err as Error).message,
    };
    lastRun = run;
    logger.error(
      `[worker:ledger-anomaly-cron] ${trigger} threw: ${(err as Error).message}`,
    );
    throw err;
  }
}

/**
 * Register the worker + schedule the daily cron job. Called from
 * `workers/index.ts`. No-op when the env gate is off.
 */
export function registerLedgerAnomalyCronWorker(): void {
  if (!isEnabled()) {
    logger.info(
      `[worker:ledger-anomaly-cron] disabled (set ${LEDGER_ANOMALY_CRON_ENABLE_ENV}=true to enable)`,
    );
    return;
  }

  const pattern = resolveCronPattern();
  logger.info(`[worker:ledger-anomaly-cron] enabling — pattern="${pattern}"`);

  // Worker — processes both the cron-fired job and the manual one-offs.
  createWorker(LEDGER_ANOMALY_CRON_QUEUE, async (job) => {
    const trigger: 'cron' | 'manual' =
      job.name === LEDGER_ANOMALY_CRON_JOB_MANUAL ? 'manual' : 'cron';
    await runOnce(trigger);
  });

  // Repeatable cron schedule. BullMQ deduplicates by `name + pattern`,
  // so re-registering at every boot is safe.
  void getQueue(LEDGER_ANOMALY_CRON_QUEUE).add(
    LEDGER_ANOMALY_CRON_JOB,
    {},
    {
      repeat: { pattern },
      jobId: `${LEDGER_ANOMALY_CRON_JOB}-singleton`,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

/**
 * Operator on-demand trigger. Enqueues a one-off manual job that the same
 * worker picks up identically to the scheduled run. Returns the enqueued
 * job id (or null when Redis is unavailable).
 */
export async function triggerScanNow(): Promise<string | null> {
  try {
    const job = await getQueue(LEDGER_ANOMALY_CRON_QUEUE).add(
      LEDGER_ANOMALY_CRON_JOB_MANUAL,
      {},
      { removeOnComplete: true, removeOnFail: false },
    );
    return job.id ?? null;
  } catch (err) {
    logger.warn(
      `[worker:ledger-anomaly-cron] triggerScanNow failed: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Test seam — call the inner runner directly without going through BullMQ.
 * Useful for unit-testing the success / error paths of the lastRun tracker.
 */
export async function __runOnceForTests(
  trigger: 'cron' | 'manual',
): Promise<LedgerAnomalyCronLastRun> {
  return runOnce(trigger);
}
