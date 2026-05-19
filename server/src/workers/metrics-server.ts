/**
 * Worker-process metrics + healthcheck server.
 *
 * Phase 0 batch 0D — worker scaffolding. Exposes Prometheus metrics
 * and a JSON healthcheck on a dedicated port (default 3002) so
 * Railway's healthcheck can poll the worker without colliding with the
 * API's own /metrics endpoint on Vercel.
 *
 * Per docs/architecture/outbox-worker-hosting.md §5.4 the worker
 * exposes Prometheus gauges for outbox depth (added in batch 0L) and
 * the BullMQ standard pack. Phase 0D ships only the framework — gauges
 * register as 0 until 0L adds the outbox model and Phase 1+ adds real
 * BullMQ jobs.
 */

import express, { type Request, type Response } from 'express';
import { register, collectDefaultMetrics, Gauge, Counter } from 'prom-client';
import logger from '../utils/logger';

// ── Metrics registry ───────────────────────────────────────────────────────

// Default Node.js process metrics (event loop lag, GC, memory, etc).
collectDefaultMetrics({ register, prefix: 'sjms_worker_' });

// Placeholder gauges/counters that batch 0L will populate with real
// outbox values. Registered here so the metric names appear in the
// /metrics output from day 1 (Prometheus prefers stable label sets).
export const outboxPendingGauge = new Gauge({
  name: 'sjms_outbox_pending_total',
  help: 'Number of OutboxEvent rows in PENDING status (per tenant, per event).',
  labelNames: ['tenant', 'event'] as const,
  registers: [register],
});

export const outboxDeadCounter = new Counter({
  name: 'sjms_outbox_dead_total',
  help: 'Cumulative count of OutboxEvent rows moved to DEAD status (per tenant, per event).',
  labelNames: ['tenant', 'event'] as const,
  registers: [register],
});

// ── Health-state tracker ────────────────────────────────────────────────────

interface WorkerHealthState {
  startedAt: Date;
  lastOutboxPolledAt: Date | null;
  lastOutboxDeliveredAt: Date | null;
  pendingOutboxEvents: number;
  deadOutboxEvents: number;
}

const state: WorkerHealthState = {
  startedAt: new Date(),
  lastOutboxPolledAt: null,
  lastOutboxDeliveredAt: null,
  pendingOutboxEvents: 0,
  deadOutboxEvents: 0,
};

/**
 * Called by the outbox-worker (added in batch 0L) on every poll
 * completion to keep the healthcheck warm. Phase 0D leaves this
 * unused; the healthcheck reports `lastOutboxPolledAt: null` until
 * 0L lands.
 */
export function updateOutboxHealth(update: Partial<Omit<WorkerHealthState, 'startedAt'>>): void {
  Object.assign(state, update);
}

// ── HTTP server ────────────────────────────────────────────────────────────

const app = express();

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
    lastOutboxPolledAt: state.lastOutboxPolledAt?.toISOString() ?? null,
    lastOutboxDeliveredAt: state.lastOutboxDeliveredAt?.toISOString() ?? null,
    pendingOutboxEvents: state.pendingOutboxEvents,
    deadOutboxEvents: state.deadOutboxEvents,
  });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

let server: ReturnType<typeof app.listen> | null = null;

export function startMetricsServer(): Promise<void> {
  const port = Number(process.env.WORKER_METRICS_PORT ?? process.env.PORT ?? 3002);
  return new Promise((resolve) => {
    server = app.listen(port, () => {
      logger.info(`[worker:metrics] listening on :${port} (GET /health, GET /metrics)`);
      resolve();
    });
  });
}

export function stopMetricsServer(): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server!.close(() => {
      logger.info('[worker:metrics] stopped');
      resolve();
    });
  });
}
