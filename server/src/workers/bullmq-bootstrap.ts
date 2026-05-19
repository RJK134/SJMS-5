/**
 * BullMQ Worker bootstrap.
 *
 * Phase 0 batch 0D — worker scaffolding. Registers a BullMQ `Worker`
 * for every queue declared in `server/src/utils/queues.ts`. The actual
 * job processors are imported lazily so adding a Phase 1+ queue
 * (finance-anomaly, hesa-xml, moodle-sync, etc.) is a single-file edit
 * to add the processor function and an entry to the dispatch table.
 *
 * Worker concurrency defaults to 1 per queue in Phase 0 — the worker
 * is on a single Railway instance per docs/architecture/outbox-worker-
 * hosting.md §10 decision 4. Phase 12 horizontal-autoscaling pass
 * raises concurrency per queue based on observed load.
 */

import { Worker } from 'bullmq';
import { QUEUE_NAMES, type QueueName, type QueuePayloads } from '../utils/queues';
import { getQueueConnection } from '../utils/redis';
import logger from '../utils/logger';

/**
 * Processor signature: takes the typed job data, returns either
 * void/undefined (success) or throws (BullMQ records as failed and
 * retries per `defaultJobOptions.attempts` in `queues.ts`).
 */
type Processor<N extends QueueName> = (data: QueuePayloads[N]) => Promise<void> | void;

// Processor registry. Add new queue processors here when Phase 1+
// batches introduce them.
const processors: { [N in QueueName]: Processor<N> } = {
  [QUEUE_NAMES.SMOKE]: async (data) => {
    logger.info('[worker:smoke] processed', {
      nonce: data.nonce,
      enqueuedAt: data.enqueuedAt,
      latencyMs: Date.now() - new Date(data.enqueuedAt).getTime(),
    });
  },
};

const workers = new Map<QueueName, Worker>();

/**
 * Start every registered Worker. Returns the count of started Workers
 * for the boot log line.
 */
export function startWorkers(): number {
  const connection = getQueueConnection();
  if (!connection) {
    logger.warn('[worker] REDIS_URL not set — no workers started. Configure REDIS_URL on the Railway worker service to enable.');
    return 0;
  }
  let started = 0;
  for (const name of Object.values(QUEUE_NAMES)) {
    if (workers.has(name)) continue;
    const processor = processors[name];
    const worker = new Worker(
      name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (job) => processor(job.data as any),
      { connection, concurrency: 1 },
    );
    worker.on('completed', (job) => {
      logger.debug(`[worker:${name}] completed ${job.name} ${job.id}`);
    });
    worker.on('failed', (job, err) => {
      logger.warn(`[worker:${name}] failed ${job?.name} ${job?.id}: ${err.message}`, { error: err.message });
    });
    workers.set(name, worker);
    started++;
  }
  logger.info(`[worker] started ${started} BullMQ worker(s) — queues: ${Array.from(workers.keys()).join(', ')}`);
  return started;
}

/**
 * Gracefully drain and close every running Worker. Used by the worker
 * process's SIGINT/SIGTERM handler so in-flight jobs finish before the
 * process exits.
 */
export async function stopWorkers(): Promise<void> {
  const closing: Promise<void>[] = [];
  for (const [, w] of workers) {
    closing.push(w.close());
  }
  await Promise.all(closing);
  workers.clear();
  logger.info('[worker] all BullMQ workers stopped');
}
