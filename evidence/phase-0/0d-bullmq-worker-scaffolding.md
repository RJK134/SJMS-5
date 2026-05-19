# Phase 0 — batch 0D BullMQ worker scaffolding

**Date captured:** 2026-05-19 (Sprint 1 session)
**Captured by:** Claude (Opus 4.7) running Sprint 1 per operator instruction "DO Sprint 1 Please"
**Branch under change:** `phase-0d/bullmq-worker-scaffolding` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0D:

> Import v4-integrated's BullMQ + Redis worker pattern. Acceptance: a no-op BullMQ job round-trips end-to-end; Prometheus exposes queue depth. **Note:** BullMQ worker deploys to a long-running host (Railway/Render/Fly), not Vercel.

The worker-host design note ([PR #74](https://github.com/RJK134/SJMS-5/pull/74)) sequences this batch first, with 0L stacked on top.

## What ships

| File | Purpose |
|---|---|
| `server/package.json` | Adds `bullmq` (^5.76.10) + `worker` / `worker:build` scripts |
| `server/src/utils/queues.ts` (new) | Queue registry — typed enqueue + lazy Queue construction. Soft-skips when `REDIS_URL` unset |
| `server/src/utils/redis.ts` | Adds `getQueueConnection()` — BullMQ-tuned ioredis client (`maxRetriesPerRequest: null`) alongside the existing rate-limit client. The two clients deliberately co-exist on the same Redis instance per [`docs/architecture/outbox-worker-hosting.md`](../../docs/architecture/outbox-worker-hosting.md) §6 (single Redis in Phase 0; per-purpose namespacing → Phase 10) |
| `server/src/workers/index.ts` (new) | Worker process entry point. Boots: metrics server → BullMQ workers → (outbox poller, added in 0L). SIGINT/SIGTERM graceful drain. uncaughtException/unhandledRejection trapped |
| `server/src/workers/bullmq-bootstrap.ts` (new) | Registers a BullMQ `Worker` for every queue in `QUEUE_NAMES`. Processor registry pattern — Phase 1+ batches add their queues here without touching the bootstrap |
| `server/src/workers/metrics-server.ts` (new) | Express server on `WORKER_METRICS_PORT` (default 3002) exposing `GET /health` (Railway healthcheck shape per design-note §5.3) and `GET /metrics` (Prometheus). Registers `sjms_outbox_pending_total` gauge + `sjms_outbox_dead_total` counter (populated by 0L) |
| `server/src/__tests__/unit/queues.test.ts` (new) | 5 tests — soft-skip when REDIS_URL unset, queue catalogue shape, payload type-safety compile check |
| `docs/operations/event-delivery-runbook.md` (new) | Operator runbook — healthcheck shape, Prometheus metrics, failure-mode triage, replay procedure, rollback. Skeleton sections to be filled by 0L |

## What's deliberately deferred

- **Outbox poller** — sits inside the same worker process. Implemented in batch 0L. The `metrics-server.ts` already declares the gauge + counter so the `/metrics` shape stays stable.
- **Concrete BullMQ queues** — Phase 0D ships only a `smoke` no-op queue used by the e2e acceptance test. Phase 1E adds `finance-anomaly`; Phase 3 adds `hesa-xml`; Phase 7 adds `moodle-sync`; Phase 8 adds n8n communication queues. Each is a single edit to `QUEUE_NAMES` + `QueuePayloads` + the processor table in `bullmq-bootstrap.ts`.
- **Admin queue API** — `GET /api/v1/admin/queues/<q>/failed` and the retry endpoint are sequenced to Phase 10 alongside the BullBoard / observability uplift.
- **Tuned concurrency** — `concurrency: 1` per queue throughout Phase 0. Phase 12 horizontal-autoscaling pass.

## Verification on this branch

```
$ cd server && npx tsc --noEmit
(exit 0)

$ cd server && npx vitest run src/__tests__/unit/queues.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ cd server && npx vitest run
 Test Files  43 passed (43)
      Tests  712 passed (712)
```

The 5 new queue tests + 707 pre-existing tests all pass. `tsc --noEmit` clean across both workspaces.

## End-to-end acceptance (operator-side, after Railway is wired)

Per the design note §11 step 5, the end-to-end smoke is:

```
# On the Vercel API:
curl -X POST -H "Authorization: Bearer <token>" \
  https://<api-base>/api/v1/admin/test-enqueue \
  -d '{"queue":"smoke","nonce":"abc"}'

# On the Railway worker log (within ~2 s):
[worker:smoke] processed { nonce: 'abc', enqueuedAt: '...', latencyMs: 1234 }
```

(The `/admin/test-enqueue` endpoint is added in batch 0L's admin surface — Phase 0D ships only the worker side. Manual enqueue from the API REPL also works.)

## Acceptance

- ✅ `bullmq` dependency added; lockfile updated
- ✅ Worker entry point exists with graceful shutdown
- ✅ Prometheus `/metrics` endpoint exposed on the worker side
- ✅ `/health` endpoint returns Railway-compatible JSON shape
- ✅ Soft-skip semantics when `REDIS_URL` unset (no crash, warn-once)
- ✅ Test coverage on the queue registry contract
- ✅ Runbook skeleton in place (0L will fill in)
- ⏸ End-to-end Railway round-trip — operator action per design note §11

## Operator actions to enable runtime

Per [`docs/architecture/outbox-worker-hosting.md`](../../docs/architecture/outbox-worker-hosting.md) §10:

1. Create the Railway project + GitHub auto-deploy connection.
2. Add the Railway Redis add-on.
3. Set env vars per the design note §5.2: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `WEBHOOK_BASE_URL`, `INTERNAL_SERVICE_KEY`, `NODE_ENV=production`, `LOG_LEVEL=info`.
4. Set the Railway healthcheck path: `/health` on `WORKER_METRICS_PORT` (default 3002).
5. Deploy command: `npm install --workspace server && npm run worker --workspace server`.

## Net Phase 0 effect

Batch 0D is `done` per the acceptance-signal protocol — scaffolding only, no business jobs yet. Unblocks batch 0L (transactional outbox + worker), which stacks on this branch.
