/**
 * Outbox dispatch — POST a single OutboxEvent row to its target webhook.
 *
 * Split out of `outbox.worker.ts` so it can be unit-tested without spinning
 * up BullMQ / Redis. The worker imports `dispatchOutboxRow()` and calls
 * it once per claimed row; the row's status transitions live in the
 * worker (so the dispatch function stays pure HTTP + signing).
 */

import crypto from 'node:crypto';
import type { OutboxEvent } from '@prisma/client';

import logger from './logger';

const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL?.trim() ||
  process.env.WEBHOOK_URL?.trim() ||
  'http://localhost:5678';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim() ?? '';
const REQUEST_TIMEOUT_MS = Number(process.env.OUTBOX_REQUEST_TIMEOUT_MS ?? 5000);

/**
 * The webhook-path scheme mirrors `webhooks.ts::EVENT_ROUTES` — one path per
 * event, prefix fallback for the rest. We duplicate the lookup here rather
 * than import from `webhooks.ts` to keep this module free of the legacy
 * in-memory retry loop.
 */
function resolveWebhookPath(eventName: string): string {
  // Common shapes:
  //   "enrolment.created"          -> "/webhook/sjms/enrolment/created"
  //   "module_results.batch_generated" -> "/webhook/sjms/module-results/batch-generated"
  const [domainSnake, actionSnake] = eventName.split('.');
  const domain = (domainSnake ?? '').replace(/_/g, '-');
  const action = (actionSnake ?? '').replace(/_/g, '-');
  return `/webhook/sjms/${domain}${action ? `/${action}` : ''}`;
}

function signPayload(body: string): string {
  if (!WEBHOOK_SECRET) return '';
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

/**
 * Dispatch a single OutboxEvent row. Throws on HTTP non-2xx so the worker
 * can record the error and decide retry vs final-fail.
 */
export async function dispatchOutboxRow(row: OutboxEvent): Promise<void> {
  const payload = {
    event: row.eventName,
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: row.actorId,
    timestamp: row.createdAt.toISOString(),
    requestId: row.requestId ?? '',
    data: row.payload,
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body);
  const path = resolveWebhookPath(row.eventName);
  const url = `${WEBHOOK_BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-event-id': row.id,
  };
  if (signature) headers['x-webhook-signature'] = signature;
  if (row.requestId) headers['x-request-id'] = row.requestId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`Webhook ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  // Drain the body so the underlying socket can be released.
  await res.text().catch(() => undefined);

  logger.info(`[outbox.dispatch] ${row.eventName} (${row.id}) delivered to ${path}`);
}

export { resolveWebhookPath, signPayload };
