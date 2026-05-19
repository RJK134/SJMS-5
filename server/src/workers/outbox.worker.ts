/**
 * Outbox worker (batch 0L).
 *
 * Drains PENDING OutboxEvent rows and dispatches them to n8n (or any future
 * webhook target). Two trigger modes share the same drain function:
 *
 *   1. **Scheduled tick** — every OUTBOX_TICK_MS (default 5s), the worker
 *      processes any rows that have been waiting. Bounds dispatch latency
 *      to ~5s even if no one explicitly enqueues a drain.
 *   2. **On-demand enqueue** — `emitOutboxEvent` can be paired with a
 *      `getQueue(OUTBOX_EVENTS).add('drain', {})` at the end of the tx to
 *      kick the worker without waiting for the next tick. (Not wired by
 *      this PR; a follow-on will add it once the worker proves stable.)
 *
 * The drain function:
 *
 *   - SELECTs a batch of N PENDING rows whose `availableAt` is past, with
 *     `FOR UPDATE SKIP LOCKED` so concurrent workers don't double-process
 *     the same row (when scaled horizontally on Railway / Render / Fly).
 *   - Marks each IN_FLIGHT.
 *   - For each, POSTs the payload to the webhook URL resolved by
 *     `webhooks.ts::resolveWebhookPath`.
 *   - On HTTP 2xx → marks DELIVERED.
 *   - On other → increments attempts, sets backoff `availableAt` (1s, 2s,
 *     4s, 8s, 16s — exponential up to MAX_OUTBOX_ATTEMPTS), reverts to
 *     PENDING. After MAX_OUTBOX_ATTEMPTS, marks FAILED for human triage.
 *
 * Idempotency: the worker is the only writer for status transitions.
 * Postgres `SELECT FOR UPDATE SKIP LOCKED` is the canonical pattern for
 * multi-worker safety; the BullMQ job itself is just an "anyone home?"
 * trigger and doesn't carry state.
 */

import logger from '../utils/logger';
import { createWorker, getQueue, QUEUE_NAMES } from '../utils/queue';
import { prisma } from '../utils/prisma';
import { OUTBOX_STATUS } from '../utils/outbox';
import { dispatchOutboxRow } from '../utils/outbox-dispatch';

const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);
const TICK_MS = Number(process.env.OUTBOX_TICK_MS ?? 5_000);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);

interface DrainSummary {
  picked: number;
  delivered: number;
  retried: number;
  failed: number;
}

/**
 * Drain up to BATCH_SIZE PENDING rows. Returns a summary of what happened.
 * Pure-callable from tests; the worker just wraps a periodic tick around it.
 */
export async function drainOutboxBatch(): Promise<DrainSummary> {
  const now = new Date();
  const summary: DrainSummary = { picked: 0, delivered: 0, retried: 0, failed: 0 };

  const claimed = await prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE SKIP LOCKED is Postgres-only and not directly
    // expressible in Prisma's query builder — drop to $queryRaw.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM outbox_events
      WHERE status = 'PENDING' AND available_at <= ${now}
      ORDER BY available_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return [];

    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: OUTBOX_STATUS.IN_FLIGHT, lastAttemptAt: now },
    });

    return tx.outboxEvent.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
  });

  summary.picked = claimed.length;

  for (const row of claimed) {
    try {
      await dispatchOutboxRow(row);
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: OUTBOX_STATUS.DELIVERED, deliveredAt: new Date() },
      });
      summary.delivered += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const backoffMs = Math.min(1000 * 2 ** attempts, 60_000);
      const availableAt = new Date(Date.now() + backoffMs);
      const isTerminal = attempts >= MAX_ATTEMPTS;
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: isTerminal ? OUTBOX_STATUS.FAILED : OUTBOX_STATUS.PENDING,
          attempts,
          errorMessage: (err as Error).message,
          availableAt: isTerminal ? row.availableAt : availableAt,
        },
      });
      if (isTerminal) summary.failed += 1;
      else summary.retried += 1;
    }
  }

  if (summary.picked > 0) {
    logger.info(
      `[outbox.worker] tick: picked=${summary.picked} delivered=${summary.delivered} retried=${summary.retried} failed=${summary.failed}`,
    );
  }
  return summary;
}

/**
 * Register the outbox worker. Two things happen:
 *
 *   1. A BullMQ Worker subscribed to QUEUE_NAMES.OUTBOX_EVENTS handles
 *      explicit drain triggers — call `getQueue(OUTBOX_EVENTS).add('drain', {})`
 *      anywhere to kick the worker.
 *   2. A setInterval ticks every TICK_MS to ensure backlog drains even
 *      with no explicit enqueue. Bounds dispatch latency to TICK_MS.
 *
 * Called from `server/src/workers/index.ts::main()`.
 */
export function registerOutboxWorker() {
  createWorker(QUEUE_NAMES.OUTBOX_EVENTS, async () => {
    await drainOutboxBatch();
  });

  const interval = setInterval(() => {
    drainOutboxBatch().catch((err) => {
      logger.warn(`[outbox.worker] tick error: ${(err as Error).message}`);
    });
  }, TICK_MS);
  // Don't keep the event loop alive solely for this interval — the worker's
  // BullMQ blocking connection is the keep-alive primary.
  if (typeof interval.unref === 'function') interval.unref();

  logger.info(
    `[outbox.worker] registered (batch=${BATCH_SIZE}, tick=${TICK_MS}ms, max-attempts=${MAX_ATTEMPTS})`,
  );
}

/** Helper for admin-retry endpoint — re-enqueue a single event for immediate drain. */
export async function enqueueOutboxDrain() {
  const queue = getQueue(QUEUE_NAMES.OUTBOX_EVENTS);
  return queue.add('drain', {});
}
