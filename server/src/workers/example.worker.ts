/**
 * Example worker — demonstrates the BullMQ pattern (batch 0D).
 *
 * This worker is intentionally trivial: it processes a `noop` job that
 * just logs the payload and resolves. The point is to give batch 0L (and
 * future batches) a copy-and-paste reference for how to register a worker
 * that the `index.ts` entry-point picks up automatically.
 *
 * Pattern:
 *
 *   1. Define a queue name in `utils/queue.ts::QUEUE_NAMES`.
 *   2. Define the job-data shape and processor function here.
 *   3. Export a `register*()` that calls `createWorker()`.
 *   4. Import + invoke from `workers/index.ts`.
 *
 * The worker auto-enrols in the shared shutdown set in `utils/queue.ts`,
 * so no extra wiring is needed for graceful SIGTERM handling.
 */

import logger from '../utils/logger';
import { createWorker, getQueue } from '../utils/queue';

const QUEUE_NAME = 'example-noop';

export interface NoopJobData {
  message: string;
}

export function registerExampleWorker() {
  createWorker<NoopJobData, void>(QUEUE_NAME, async (job) => {
    logger.info(
      `[example.worker] job ${job.id}: "${job.data.message}" (attempt ${job.attemptsMade + 1})`,
    );
  });
}

/**
 * Helper for tests + manual triggers — enqueue a noop job.
 */
export async function enqueueNoop(message: string) {
  const queue = getQueue<NoopJobData>(QUEUE_NAME);
  return queue.add('noop', { message });
}
