/**
 * BullMQ queue + worker scaffolding (batch 0D).
 *
 * This module is the single entry point for asynchronous job processing in
 * SJMS-5. Two consumers exist or are planned:
 *
 *   - **Outbox events** (batch 0L) — a `dispatchOutboxEvent` job per
 *     OutboxEvent row, processed by a long-running worker that POSTs the
 *     event payload to n8n (or any future webhook target) and writes the
 *     delivery outcome back to the row.
 *   - **Future scheduled jobs** — e.g. payment-instalment auto-charge
 *     (Phase 18 follow-on), HESA snapshot generation, batch-imports from
 *     the data lake (Phase 12 / D-series follow-on).
 *
 * Design constraints:
 *
 *   1. **Real Redis required.** BullMQ uses Lua scripts and blocking
 *      commands; the no-op redis shim in `redis.ts` is not compatible.
 *      `getQueue()` / `createWorker()` throw a clear error when
 *      `REDIS_URL` is unset rather than silently degrading.
 *   2. **Single connection per process.** Each Queue / QueueEvents / Worker
 *      instance owns its own ioredis connection (BullMQ requires
 *      `maxRetriesPerRequest: null` and `enableReadyCheck: false` on
 *      worker connections — different from the rate-limit client's
 *      settings). We cache the Queue per name so call sites don't open
 *      hundreds of connections.
 *   3. **Graceful shutdown.** `closeAllQueues()` and `closeWorker()` are
 *      exported so the worker entry-point can drain on SIGTERM (Vercel
 *      Fluid Compute and most container runtimes guarantee a drain window).
 *   4. **Vercel deployment note.** BullMQ workers cannot run on Vercel
 *      Functions (no long-running processes). The worker entry-point is
 *      intended for Railway / Render / Fly / a local VM — see
 *      `evidence/phase-0/0d-bullmq-worker.md` for the deployment matrix.
 *      Tracked in KI-S5-201.
 */

import IORedis, { Redis as RedisType } from 'ioredis';
import { Queue, Worker, QueueEvents } from 'bullmq';
import type { Processor, WorkerOptions, QueueOptions } from 'bullmq';

import logger from './logger';

const REDIS_URL = process.env.REDIS_URL?.trim();

/**
 * The default job-options applied to every queue. Individual `add()` calls
 * may override.
 *
 *   - `attempts: 5` — five retries before the job lands in the failed list.
 *   - `backoff: exponential, 60s starting delay` — picks up transient
 *     failures (network blips, n8n rate-limits) without hammering the
 *     downstream.
 *   - `removeOnComplete: { age: 7 days, count: 1000 }` — keep recent
 *     successes for debugging, prune the rest. The 0L outbox keeps its
 *     own per-row record so we don't double-store.
 *   - `removeOnFail: { age: 30 days }` — keep failures longer for
 *     post-mortems.
 */
export const DEFAULT_JOB_OPTIONS: NonNullable<QueueOptions['defaultJobOptions']> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 30 * 24 * 60 * 60 },
};

function assertRedisAvailable(): string {
  if (!REDIS_URL) {
    throw new Error(
      'BullMQ requires REDIS_URL to be set. The no-op redis shim used elsewhere ' +
        'cannot satisfy BullMQ\'s Lua scripting + blocking-command requirements. ' +
        'Set REDIS_URL to a reachable Redis instance (Redis 7+).',
    );
  }
  return REDIS_URL;
}

/**
 * Create a queue-tier connection: the connection BullMQ uses for the Queue
 * itself (job enqueue, list mutation, etc.). Defaults match BullMQ's
 * recommended settings for the "client" connection.
 */
function createQueueConnection(): RedisType {
  return new IORedis(assertRedisAvailable(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

/**
 * Create a worker-tier connection: BullMQ requires the worker connection to
 * have `maxRetriesPerRequest: null` (blocking BRPOPLPUSH would otherwise
 * give up after N retries and crash the worker). We also disable the ready
 * check so a brief Redis blip during worker startup doesn't abort.
 */
function createWorkerConnection(): RedisType {
  return new IORedis(assertRedisAvailable(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

const queueCache = new Map<string, Queue>();
const queueEventsCache = new Map<string, QueueEvents>();
const workers = new Set<Worker>();

/**
 * Get (or create) the Queue for `name`. Cached per process — call as many
 * times as you like, you'll get back the same instance.
 *
 * Throws if REDIS_URL is unset.
 */
export function getQueue<T = unknown>(name: string): Queue<T> {
  const cached = queueCache.get(name);
  if (cached) return cached as Queue<T>;

  const queue = new Queue<T>(name, {
    connection: createQueueConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queue.on('error', (err) => {
    logger.warn(`[queue:${name}] error: ${err.message}`);
  });

  queueCache.set(name, queue as Queue);
  return queue;
}

/**
 * Get (or create) the QueueEvents listener for `name`. Use sparingly — each
 * QueueEvents instance opens a dedicated blocking connection. Suitable for
 * a single observer process (e.g. a metrics-exporter) but not for every
 * job-producing request handler.
 */
export function getQueueEvents(name: string): QueueEvents {
  const cached = queueEventsCache.get(name);
  if (cached) return cached;

  const events = new QueueEvents(name, {
    connection: createQueueConnection(),
  });
  queueEventsCache.set(name, events);
  return events;
}

/**
 * Spawn a worker for `name`. The worker registers itself in the module's
 * shutdown set so `closeAllWorkers()` can drain it on SIGTERM.
 *
 * Pass `concurrency: N` to process up to N jobs in parallel within this
 * worker process. Defaults to 1 (strict serial), which is the right default
 * for outbox-event delivery (in-order, idempotent, low-throughput).
 */
export function createWorker<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  options: Partial<WorkerOptions> = {},
): Worker<T, R> {
  const worker = new Worker<T, R>(name, processor, {
    connection: createWorkerConnection(),
    concurrency: 1,
    ...options,
  });

  worker.on('completed', (job) => {
    logger.info(`[worker:${name}] job ${job.id} completed`);
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      `[worker:${name}] job ${job?.id ?? 'unknown'} failed: ${err.message}`,
    );
  });
  worker.on('error', (err) => {
    logger.warn(`[worker:${name}] worker error: ${err.message}`);
  });

  workers.add(worker);
  return worker;
}

/**
 * Drain every worker spawned via `createWorker()`. Idempotent — safe to call
 * multiple times. Used by the worker entry-point's SIGTERM handler.
 */
export async function closeAllWorkers(): Promise<void> {
  const drains = Array.from(workers).map(async (w) => {
    try {
      await w.close();
    } catch (err) {
      logger.warn(`[worker] close error: ${(err as Error).message}`);
    }
  });
  await Promise.all(drains);
  workers.clear();
}

/**
 * Drain every queue / queue-events listener. Used by the worker entry-point's
 * SIGTERM handler so all blocking connections release before exit.
 */
export async function closeAllQueues(): Promise<void> {
  const drains = [
    ...Array.from(queueCache.values()).map((q) =>
      q.close().catch((err) => logger.warn(`[queue] close error: ${err.message}`)),
    ),
    ...Array.from(queueEventsCache.values()).map((e) =>
      e.close().catch((err) => logger.warn(`[queue-events] close error: ${err.message}`)),
    ),
  ];
  await Promise.all(drains);
  queueCache.clear();
  queueEventsCache.clear();
}

/**
 * Registered queue names. Each consumer module re-exports the relevant name
 * here so call sites can grep for them in one place.
 */
export const QUEUE_NAMES = {
  /** Outbox event delivery — see batch 0L. */
  OUTBOX_EVENTS: 'outbox-events',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
