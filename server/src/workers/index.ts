/**
 * SJMS-5 worker entry-point (batch 0D).
 *
 * Runs every registered worker in a single long-running process. Designed
 * for Railway / Render / Fly / a local always-on VM — Vercel Functions
 * cannot host blocking BullMQ workers (KI-S5-201).
 *
 * Usage:
 *
 *   # From the repo root:
 *   npm run --workspace=server worker
 *
 *   # Or directly:
 *   tsx server/src/workers/index.ts
 *
 * Environment variables required:
 *
 *   - `REDIS_URL`              — reachable Redis 7+ instance
 *   - `DATABASE_URL`           — Postgres (for worker-side Prisma calls)
 *   - `WORKER_CONCURRENCY`     — optional, default 1 per worker
 *
 * Each registered worker file lives next to this index. To add a new
 * worker, create `server/src/workers/<name>.ts` exporting a `register()`
 * function that calls `createWorker()` from `utils/queue.ts`, and import
 * it here.
 *
 * Graceful shutdown: SIGTERM and SIGINT trigger `closeAllWorkers()` +
 * `closeAllQueues()` so blocking connections release cleanly.
 */

import 'dotenv/config';

import logger from '../utils/logger';
import { closeAllWorkers, closeAllQueues } from '../utils/queue';
import { registerExampleWorker } from './example.worker';
import { registerOutboxWorker } from './outbox.worker';
import { registerPaymentInstalmentCronWorker } from './payment-instalment-cron.worker';
import { registerLedgerAnomalyCronWorker } from './ledger-anomaly-cron.worker';

async function main() {
  logger.info('[workers] starting registered workers...');

  // Each registered worker contributes a Worker instance to the shared
  // shutdown set in utils/queue.ts. Add new workers below as they land.
  registerExampleWorker();
  registerOutboxWorker();
  registerPaymentInstalmentCronWorker();
  registerLedgerAnomalyCronWorker();

  logger.info('[workers] all workers registered; entering idle wait loop');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[workers] ${signal} received — draining workers...`);
    try {
      await closeAllWorkers();
      await closeAllQueues();
      logger.info('[workers] drain complete; exiting');
      process.exit(0);
    } catch (err) {
      logger.warn(`[workers] drain error: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the process alive. Workers run their own event loops; this `await`
  // never resolves until shutdown fires.
  await new Promise<void>(() => {});
}

main().catch((err) => {
  logger.error(`[workers] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ''}`);
  process.exit(1);
});
