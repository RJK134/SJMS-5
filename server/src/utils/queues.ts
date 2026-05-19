/**
 * BullMQ queue registry — server side (API-process consumers).
 *
 * Phase 0 batch 0D — worker scaffolding (closes deferred work item in
 * docs/SJMS-5-BUILD-QUEUE.md Phase 0 batch list).
 *
 * The Vercel-hosted API enqueues jobs onto these queues; the Railway-
 * hosted worker process (server/src/workers/*) dequeues and processes
 * them. Both sides import this module so the queue names and payload
 * shapes are the single source of truth.
 *
 * Per docs/architecture/outbox-worker-hosting.md §6, all queues share
 * the same Redis instance in Phase 0; per-purpose namespacing is
 * Phase 10 work (KI-S5-319).
 *
 * Phase 0D ships the REGISTRY with one no-op queue used by the
 * end-to-end smoke test. Phase 1E adds `finance-anomaly`; Phase 3 adds
 * `hesa-xml`; Phase 7 adds `moodle-sync`; Phase 8 adds the n8n
 * communication queues. Adding a new queue is:
 *   1. Append to `QUEUE_NAMES` below
 *   2. Add the payload type to `QueuePayloads`
 *   3. Register a processor in server/src/workers/bullmq-bootstrap.ts
 */

import { Queue } from 'bullmq';
import { getQueueConnection } from './redis';
import logger from './logger';

// ── Queue catalogue ────────────────────────────────────────────────────────

/**
 * Canonical queue names. Strings are also the BullMQ queue keys in
 * Redis (prefix is `bull` by default until Phase 10 namespacing).
 *
 * British English in user-facing event names per operating-model.
 * Underscored snake_case for queue ids (BullMQ idiomatic).
 */
export const QUEUE_NAMES = {
  /** Phase 0D smoke job — no business effect; used by 0D acceptance test. */
  SMOKE: 'smoke',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Type-safe payload shapes per queue. Add new entries here whenever a
 * new queue is registered so enqueue + process sites stay in lockstep.
 */
export interface QueuePayloads {
  [QUEUE_NAMES.SMOKE]: {
    nonce: string;
    enqueuedAt: string;
  };
}

// ── Queue instances ────────────────────────────────────────────────────────

const queues = new Map<QueueName, Queue>();

/**
 * Lazy-construct a typed Queue handle. Reuses the singleton ioredis
 * connection from `utils/redis.ts` so we don't open a new connection
 * per enqueue. Returns `null` when Redis is not configured (matches
 * `utils/redis.ts` no-op shim semantics) so the API can degrade
 * gracefully — calls become no-ops with a warn-once log.
 */
export function getQueue<N extends QueueName>(name: N): Queue<QueuePayloads[N], unknown, string> | null {
  const connection = getQueueConnection();
  if (!connection) {
    return null;
  }
  let existing = queues.get(name);
  if (!existing) {
    existing = new Queue<QueuePayloads[N], unknown, string>(name as string, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 10_000 }, // keep 24h or 10k, whichever sooner
        removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep failed jobs 7 days
      },
    });
    queues.set(name, existing);
  }
  return existing as Queue<QueuePayloads[N], unknown, string>;
}

/**
 * Convenience enqueue wrapper. Logs at info on success, warn when Redis
 * is unconfigured (job silently dropped — operator must wire REDIS_URL
 * for any Phase 1+ work that depends on BullMQ to function).
 */
export async function enqueue<N extends QueueName>(
  name: N,
  jobName: string,
  payload: QueuePayloads[N],
): Promise<string | null> {
  const queue = getQueue(name);
  if (!queue) {
    logger.warn(`[queues] dropped job ${name}:${jobName} — REDIS_URL not configured`, { name, jobName });
    return null;
  }
  // BullMQ's typed Queue<Data, Result, Name>.add uses ExtractNameType which
  // doesn't simplify cleanly when Data is a discriminated union; casting
  // through the queue's `as Queue<unknown>` keeps the runtime call
  // identical (BullMQ stores jobName as a string regardless of typing).
  const job = await (queue as unknown as Queue).add(jobName, payload);
  logger.info(`[queues] enqueued ${name}:${jobName} as ${job.id}`, { name, jobName, jobId: job.id });
  return job.id ?? null;
}

/**
 * Close all open Queue handles. Called by the worker on graceful
 * shutdown so the BullMQ Redis connections drain cleanly.
 */
export async function closeAllQueues(): Promise<void> {
  const closing: Promise<void>[] = [];
  for (const [, q] of queues) {
    closing.push(q.close());
  }
  await Promise.all(closing);
  queues.clear();
}
