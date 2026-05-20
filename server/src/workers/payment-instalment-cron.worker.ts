/**
 * Payment-instalment cron worker (Phase 1A).
 *
 * Daily BullMQ schedule that calls
 * `paymentInstalmentsService.processOverdueInstalments(...)` to
 * auto-generate ChargeLines for every PaymentInstalment whose dueDate
 * has passed and whose status is still PENDING. The issued ChargeLines
 * are then visible to the Phase 18C payment-allocation pipeline so an
 * operator-recorded Payment can absorb them through the existing
 * `recordPayment` bridge.
 *
 * Closes SJMS-2.5 Phase 18D's "Auto-generation of ChargeLines when an
 * instalment falls due" deferred item (which was earmarked for a
 * Phase 20 n8n scheduled job; SJMS-5 lands it earlier as a Phase 1A
 * BullMQ cron now that 0D's worker scaffolding is on `main`).
 *
 * **Gating**: registration is opt-in via
 * `SJMS_ENABLE_PAYMENT_INSTALMENT_CRON=true`. Dev, test, and any
 * Vercel API process never connect to Redis or attempt to enqueue
 * cron rows. Only the long-running worker process on
 * Railway / Render / Fly (per docs/architecture/outbox-worker-hosting.md)
 * sets the flag, so registration is idempotent and one-per-process.
 *
 * **Schedule**: daily at 02:30 UTC. Chosen as a quiet pre-dawn UK slot,
 * after midnight billing-day rollover and before the 06:00 dataset
 * snapshot. Override via `SJMS_PAYMENT_INSTALMENT_CRON_PATTERN`.
 *
 * **Operator on-demand**: `triggerProcessOverdueNow()` enqueues a
 * one-off `manual-payment-instalment-cron` job that the same worker
 * picks up identically. Surfaces via
 * `getLastPaymentInstalmentCronRun()` for `/health`-style consumers.
 */

import logger from '../utils/logger';
import { createWorker, getQueue } from '../utils/queue';
import { processOverdueInstalments } from '../api/payment-instalments/payment-instalments.service';

/** Queue carrying the daily cron and operator-triggered one-offs. */
export const PAYMENT_INSTALMENT_CRON_QUEUE = 'payment-instalment-cron';
/** Job name attached to the daily cron schedule. */
export const PAYMENT_INSTALMENT_CRON_JOB = 'daily-payment-instalment-cron';
/** Job name attached to operator one-offs. */
export const PAYMENT_INSTALMENT_CRON_JOB_MANUAL = 'manual-payment-instalment-cron';
/** Default cron pattern — daily at 02:30 UTC. */
export const PAYMENT_INSTALMENT_CRON_DEFAULT_PATTERN = '30 2 * * *';
/** Env-gate the registration so non-worker processes never touch Redis. */
export const PAYMENT_INSTALMENT_CRON_ENABLE_ENV =
  'SJMS_ENABLE_PAYMENT_INSTALMENT_CRON' as const;
/** Override the cron pattern at deploy time without code changes. */
export const PAYMENT_INSTALMENT_CRON_PATTERN_ENV =
  'SJMS_PAYMENT_INSTALMENT_CRON_PATTERN' as const;

export interface PaymentInstalmentCronLastRun {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  trigger: 'cron' | 'manual';
  /** Number of overdue PENDING instalments seen by the run. */
  total: number;
  /** Number of new ChargeLines issued. */
  charged: number;
  /** Number of instalments skipped (already had a ChargeLine). */
  skipped: number;
  /** Number of instalments where charge issuance threw. */
  failed: number;
  /** Captured error message when the job itself threw. */
  errorMessage?: string;
}

let lastRun: PaymentInstalmentCronLastRun | null = null;

/** Last-run accessor for `/health` and operator dashboards. */
export function getLastPaymentInstalmentCronRun(): PaymentInstalmentCronLastRun | null {
  return lastRun;
}

/** Test-only hook — reset the in-process cache between cases. */
export function __resetLastPaymentInstalmentCronRunForTests(): void {
  lastRun = null;
}

function resolveCronPattern(): string {
  return (
    process.env[PAYMENT_INSTALMENT_CRON_PATTERN_ENV]?.trim() ||
    PAYMENT_INSTALMENT_CRON_DEFAULT_PATTERN
  );
}

function isEnabled(): boolean {
  return process.env[PAYMENT_INSTALMENT_CRON_ENABLE_ENV]?.trim().toLowerCase() === 'true';
}

/**
 * Worker job handler. Calls the service method, records the outcome in
 * `lastRun`, and lets BullMQ retry per the queue's defaultJobOptions if
 * the call throws.
 */
async function runOnce(trigger: 'cron' | 'manual'): Promise<PaymentInstalmentCronLastRun> {
  const startedAt = new Date();
  try {
    const outcome = await processOverdueInstalments({ asOf: startedAt, trigger });
    const completedAt = new Date();
    const run: PaymentInstalmentCronLastRun = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: 'ok',
      trigger,
      total: outcome.total,
      charged: outcome.charged,
      skipped: outcome.skipped,
      failed: outcome.failed,
    };
    lastRun = run;
    logger.info(
      `[worker:payment-instalment-cron] ${trigger}: ${outcome.charged}/${outcome.total} charged, ${outcome.skipped} skipped, ${outcome.failed} failed in ${run.durationMs}ms`,
    );
    return run;
  } catch (err) {
    const completedAt = new Date();
    const run: PaymentInstalmentCronLastRun = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: 'error',
      trigger,
      total: 0,
      charged: 0,
      skipped: 0,
      failed: 0,
      errorMessage: (err as Error).message,
    };
    lastRun = run;
    logger.error(
      `[worker:payment-instalment-cron] ${trigger} threw: ${(err as Error).message}`,
    );
    throw err;
  }
}

/**
 * Register the worker + schedule the daily cron job. Called from
 * `workers/index.ts`. No-op when the env gate is off.
 */
export function registerPaymentInstalmentCronWorker(): void {
  if (!isEnabled()) {
    logger.info(
      `[worker:payment-instalment-cron] disabled (set ${PAYMENT_INSTALMENT_CRON_ENABLE_ENV}=true to enable)`,
    );
    return;
  }

  const pattern = resolveCronPattern();
  logger.info(
    `[worker:payment-instalment-cron] enabling — pattern="${pattern}"`,
  );

  // Worker — processes both the cron-fired job and the manual one-offs.
  createWorker(PAYMENT_INSTALMENT_CRON_QUEUE, async (job) => {
    const trigger: 'cron' | 'manual' =
      job.name === PAYMENT_INSTALMENT_CRON_JOB_MANUAL ? 'manual' : 'cron';
    await runOnce(trigger);
  });

  // Repeatable cron schedule. BullMQ deduplicates by `name + pattern`,
  // so re-registering at every boot is safe.
  void getQueue(PAYMENT_INSTALMENT_CRON_QUEUE).add(
    PAYMENT_INSTALMENT_CRON_JOB,
    {},
    {
      repeat: { pattern },
      jobId: `${PAYMENT_INSTALMENT_CRON_JOB}-singleton`,
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

/**
 * Operator on-demand trigger. Enqueues a one-off manual job that the
 * same worker picks up identically to the scheduled run. Returns the
 * enqueued job id (or null when Redis is unavailable).
 */
export async function triggerProcessOverdueNow(): Promise<string | null> {
  try {
    const job = await getQueue(PAYMENT_INSTALMENT_CRON_QUEUE).add(
      PAYMENT_INSTALMENT_CRON_JOB_MANUAL,
      {},
      { removeOnComplete: true, removeOnFail: false },
    );
    return job.id ?? null;
  } catch (err) {
    logger.warn(
      `[worker:payment-instalment-cron] triggerProcessOverdueNow failed: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * Test seam — call the inner runner directly without going through
 * BullMQ. Useful for unit-testing the success / error paths of the
 * lastRun tracker.
 */
export async function __runOnceForTests(
  trigger: 'cron' | 'manual',
): Promise<PaymentInstalmentCronLastRun> {
  return runOnce(trigger);
}
