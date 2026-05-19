# Batch 0L — Transactional outbox + worker (load-bearing)

> **Captured:** 2026-05-19
> **Companion to:** [`docs/phase-0/README.md`](../../docs/phase-0/README.md) batch 0L row.
> **Closes:** KI-S5-301 (no transactional outbox).

## Why this matters

Every business mutation in SJMS-5 today emits a webhook via `utils/webhooks.ts::emitEvent` — a fire-and-forget HTTP POST with an in-memory retry loop. When the service process crashes between the business commit and the webhook delivery (Vercel cold-shutdown, container restart, network blip), **the event is lost forever**. The downstream (n8n workflow, audit consumer, future integrator) never sees it. No alarm fires.

The transactional outbox makes event emission atomic with the underlying state change:

```
                BEFORE                                  AFTER (0L)

Service                  n8n              Service                       n8n
  |                       |                 |                             |
  |-- tx begin ---------->|                 |-- tx begin ---------------->|
  |-- INSERT business     |                 |-- INSERT business           |
  |-- COMMIT              |                 |-- INSERT outbox row         |
  |                       |                 |-- COMMIT                    |
  |-- fetch() -->X        |                 |                             |
  |   (crash, drop)       |                 |   (later, async)            |
  |                       |                 |-- worker SELECTs PENDING -->|
  X event lost            |                 |   FOR UPDATE SKIP LOCKED    |
                                            |-- POSTs to n8n ------------>|
                                            |-- marks DELIVERED           |
                                            |                             |
                                            ✓ event survives every crash
```

## What this PR adds

| File | Role |
|---|---|
| `prisma/schema.prisma` | New `OutboxEvent` model + `OutboxEventStatus` enum (PENDING / IN_FLIGHT / DELIVERED / FAILED / DISCARDED). Indexes on `(status, available_at)` for the drain query and `(entity_type, entity_id)` for backfill lookups. |
| `prisma/migrations/20260519000000_add_outbox_events/migration.sql` | The corresponding migration. Plain `CREATE TABLE` + 3 indexes + the enum. |
| `server/src/utils/outbox.ts` | `emitOutboxEvent(input, tx)` helper. Tx-aware so service-layer call sites pass `tx` from inside `prisma.$transaction` for atomic semantics. Falls back to the non-tx client for backfill / admin-retry paths. |
| `server/src/utils/outbox-dispatch.ts` | Pure HTTP layer — `dispatchOutboxRow(row)` POSTs the row's payload to the resolved webhook URL with HMAC-SHA256 signature (when WEBHOOK_SECRET is set) and the `x-event-id` / `x-request-id` headers. Split out of the worker so it's unit-testable without BullMQ/Redis. |
| `server/src/workers/outbox.worker.ts` | The drain orchestrator. `drainOutboxBatch()` claims up to N rows with `SELECT ... FOR UPDATE SKIP LOCKED`, flips them IN_FLIGHT, calls `dispatchOutboxRow()` per row, and marks DELIVERED / PENDING (with exponential backoff) / FAILED (after MAX_ATTEMPTS). Registered via `registerOutboxWorker()` from `workers/index.ts`. |
| `server/src/__tests__/unit/outbox.test.ts` | 4 tests — emit-with-default-context, emit-with-explicit-availableAt/requestId, tx-client-honoured, OUTBOX_STATUS constants. |
| `server/src/__tests__/unit/outbox-dispatch.test.ts` | 8 tests — path resolution (snake_case → kebab-case), HMAC signing (with + without secret), POST shape, x-event-id / x-request-id headers, non-2xx throws (404 + 503 cases). |

## Drain loop semantics

The worker has two trigger modes that share the same drain function:

1. **Scheduled tick** (`OUTBOX_TICK_MS`, default 5,000 ms) — ensures backlog drains even with no explicit enqueue. Bounds dispatch latency to ~5 s.
2. **On-demand BullMQ enqueue** (`getQueue(OUTBOX_EVENTS).add('drain', {})`) — for the future emit-then-kick pattern. Not wired into service layers in this PR; admin endpoints can call `enqueueOutboxDrain()` for immediate retry.

Each tick:

```
BEGIN TRANSACTION
  SELECT id FROM outbox_events
    WHERE status = 'PENDING' AND available_at <= NOW()
    ORDER BY available_at ASC
    LIMIT 50
    FOR UPDATE SKIP LOCKED;
  UPDATE outbox_events
    SET status = 'IN_FLIGHT', last_attempt_at = NOW()
    WHERE id IN (...);
COMMIT

# outside the tx, for each claimed row:
dispatchOutboxRow(row)
  -> on 2xx: UPDATE status = 'DELIVERED', delivered_at = NOW()
  -> on error: UPDATE status = 'PENDING' | 'FAILED' (after MAX_ATTEMPTS),
               attempts += 1,
               error_message = err,
               available_at = NOW() + exponential-backoff (1s, 2s, 4s, 8s, ..., capped at 60s)
```

`FOR UPDATE SKIP LOCKED` is the canonical Postgres pattern for multi-worker safety: two workers scaled horizontally (Railway / Render / Fly replicas) will each claim disjoint subsets of the PENDING rows without contention.

## Defaults (overridable via env)

| Var | Default | Meaning |
|---|---|---|
| `OUTBOX_BATCH_SIZE` | 50 | Rows claimed per tick |
| `OUTBOX_TICK_MS` | 5000 | Tick interval |
| `OUTBOX_MAX_ATTEMPTS` | 5 | After this many attempts, status flips FAILED for human triage |
| `OUTBOX_REQUEST_TIMEOUT_MS` | 5000 | HTTP timeout per dispatch |

## Verification

```
$ pnpm exec vitest run src/__tests__/unit/outbox.test.ts src/__tests__/unit/outbox-dispatch.test.ts
✓ src/__tests__/unit/outbox.test.ts (4 tests)
✓ src/__tests__/unit/outbox-dispatch.test.ts (8 tests)

Test Files  2 passed (2)
     Tests  12 passed (12)
```

`prisma validate` clean (with `DATABASE_URL` + `DIRECT_URL` set). `prisma generate` clean. Migration SQL has been hand-verified against the Prisma 6.19 migration emitter convention.

## What 0L does NOT do (sequenced to follow-ons)

- **Service-layer migration.** This PR establishes the outbox primitive but does not migrate the ~140 `emitEvent(...)` call sites in `server/src/api/**/*.service.ts` to `emitOutboxEvent(...)` inside their transactions. That's a mechanical sweep (one call site per service mutation, ~20-30 PRs of ~5-10 sites each) sequenced as **KI-S5-301-2**, opened on completion of 0L. Until that's done, both pathways co-exist: existing services still fire `emitEvent` (fire-and-forget, non-durable), and new services / future PRs can opt into `emitOutboxEvent` for durability.
- **Admin endpoints.** `GET /v1/admin/outbox-events?status=FAILED`, `POST /v1/admin/outbox-events/:id/retry`, `POST /v1/admin/outbox-events/:id/discard` — sequenced to Phase 21 portal-completion. For now operators query the `outbox_events` table directly via `psql` for incident triage.
- **Prometheus metrics.** Queue depth, delivery latency, fail rate — sequenced to Phase 22 analytics-observability. The existing `prom-client` instrumentation pattern in `server/src/utils/metrics.ts` is the carrier.
- **Round-trip integration test against real Redis + Postgres.** The unit tests cover the pure logic; an integration test that writes a row, lets the worker drain it, and verifies an n8n stub receives the POST belongs to Phase 0I's CI baseline (a dedicated Docker-Compose CI job).
- **Bull-Board / Arena admin UI** for the BullMQ queue itself — Phase 21 if operators ask.

## Acceptance signal

Closes batch 0L per the Phase 0 build queue. Closes KI-S5-301 (no transactional outbox). Unblocks every Phase 1+ business-rule batch that wants atomic event delivery (Phase 1 finance closeout, Phase 8 n8n activation, Phase 11 AI-native operating layer).

Service-layer adoption proceeds incrementally — every new mutation lands with `emitOutboxEvent` by default; existing `emitEvent` call sites get migrated batch by batch under **KI-S5-301-2**.
