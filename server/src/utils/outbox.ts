/**
 * Transactional outbox helper (batch 0L).
 *
 * Writes an OutboxEvent row inside the caller's transaction so event
 * delivery is atomic with the underlying state change. A separate BullMQ
 * worker (server/src/workers/outbox.worker.ts) drains PENDING rows and
 * dispatches them to n8n (or any future webhook target).
 *
 * Why not fire-and-forget HTTP from the service layer:
 *
 *   Service                          n8n
 *     |                                |
 *     |-- prisma.$transaction begin -->|
 *     |-- INSERT business row          |
 *     |-- COMMIT                       |
 *     |                                |
 *     |-- fetch(webhook url) -->X      |  process crash, network blip,
 *     |                                |  Vercel cold shutdown -> event
 *     |                                |  lost forever
 *
 * With the outbox:
 *
 *     |-- prisma.$transaction begin -->|
 *     |-- INSERT business row          |
 *     |-- INSERT outbox row            |  durable in Postgres
 *     |-- COMMIT                       |
 *     |   ...                          |
 *     |                                |  worker picks up the row on
 *     |                                |  its own schedule, dispatches,
 *     |                                |  marks DELIVERED — survives
 *     |                                |  every kind of process restart
 *
 * Call sites:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const enrolment = await tx.enrolment.create({ data: ... });
 *     await emitOutboxEvent({
 *       eventName: 'enrolment.created',
 *       entityType: 'Enrolment',
 *       entityId: enrolment.id,
 *       actorId: userId,
 *       payload: { id: enrolment.id, studentId: enrolment.studentId, ... },
 *     }, tx);
 *   });
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { getRequestId } from './request-context';
import { prisma } from './prisma';

export interface OutboxEventInput {
  eventName: string;
  entityType: string;
  entityId: string;
  actorId: string;
  payload: Record<string, unknown>;
  /** Optional explicit availability time — defaults to "now" (immediately drainable). */
  availableAt?: Date;
  /** Optional explicit request id — defaults to the AsyncLocalStorage-bound request id. */
  requestId?: string | null;
}

/**
 * Tx-aware writer. Pass the transaction client from `prisma.$transaction`'s
 * callback so the row is committed atomically with the business mutation.
 *
 * Call with `prisma` (the non-tx client) for non-transactional emits — useful
 * for backfills or admin retries.
 */
export async function emitOutboxEvent(
  input: OutboxEventInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
) {
  return client.outboxEvent.create({
    data: {
      eventName: input.eventName,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      payload: input.payload as Prisma.InputJsonValue,
      requestId: input.requestId ?? getRequestId() ?? null,
      availableAt: input.availableAt ?? new Date(),
    },
  });
}

/**
 * Re-export of the OutboxEventStatus enum so call sites don't need a
 * direct dependency on @prisma/client. Mirrors the schema.
 */
export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  DISCARDED: 'DISCARDED',
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];
