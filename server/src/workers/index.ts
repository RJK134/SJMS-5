/**
 * Worker process entry point.
 *
 * Phase 0 batch 0D — worker scaffolding (per docs/architecture/
 * outbox-worker-hosting.md §5.1).
 *
 * Boots three subsystems in one process on the Railway long-running
 * host (per operating-model §13 — workers do NOT run on Vercel):
 *
 *   1. BullMQ Workers for every registered queue (bullmq-bootstrap.ts)
 *   2. Outbox poller (outbox-worker.ts — added in batch 0L)
 *   3. Prometheus metrics + Railway healthcheck server (metrics-server.ts)
 *
 * Started locally with `npm run worker --workspace server` for dev,
 * or via Railway's auto-deploy from `main` per the design note.
 *
 * SIGINT / SIGTERM trigger a graceful drain: stop accepting new BullMQ
 * jobs, finish in-flight jobs, close DB and Redis connections, exit 0.
 * Railway sends SIGTERM on redeploy and gives a 10s grace window.
 */

import 'dotenv/config';
import logger from '../utils/logger';
import { startWorkers, stopWorkers } from './bullmq-bootstrap';
import { startMetricsServer, stopMetricsServer } from './metrics-server';
import { closeAllQueues } from '../utils/queues';

async function main(): Promise<void> {
  logger.info('[worker] starting SJMS-5 worker process', {
    nodeVersion: process.version,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    redisConfigured: !!process.env.REDIS_URL,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? '(unset)',
  });

  // 1. Healthcheck + metrics first so Railway sees a live process
  await startMetricsServer();

  // 2. BullMQ workers (no-op until Phase 1+ adds real queues)
  const workerCount = startWorkers();

  // 3. Outbox poller — added in batch 0L. Phase 0D ships only the
  //    scaffolding; the actual poll loop bootstrap is committed when
  //    the OutboxEvent Prisma model lands.

  logger.info(`[worker] startup complete (${workerCount} BullMQ worker(s); outbox poller pending batch 0L)`);

  // ── Graceful shutdown ─────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[worker] ${signal} received — draining`);
    try {
      await stopWorkers();
      await closeAllQueues();
      await stopMetricsServer();
      logger.info('[worker] graceful shutdown complete — exit 0');
      process.exit(0);
    } catch (err) {
      logger.error('[worker] shutdown error', { error: (err as Error).message });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('[worker] uncaughtException', { error: err.message, stack: err.stack });
    void shutdown('SIGTERM');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('[worker] unhandledRejection', { reason: String(reason) });
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  logger.error('[worker] fatal startup error', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
