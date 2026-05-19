# Batch 0D — BullMQ + Redis worker scaffolding

> **Captured:** 2026-05-19
> **Companion to:** [`docs/phase-0/README.md`](../../docs/phase-0/README.md) batch 0D row.

## What this PR adds

A reusable BullMQ-based queue + worker pattern on top of the existing Redis 7 service. Three new files plus a docker-compose entry:

| File | Role |
|---|---|
| `server/src/utils/queue.ts` | Queue / QueueEvents / Worker factories. Caches per-name so call sites don't open hundreds of Redis connections. Exports `closeAllWorkers()` + `closeAllQueues()` for SIGTERM drain. |
| `server/src/workers/index.ts` | Worker process entry-point. Registers every worker; handles SIGTERM/SIGINT graceful shutdown. |
| `server/src/workers/example.worker.ts` | Reference implementation for batch 0L (outbox) and future workers. Trivial noop processor. |
| `server/src/__tests__/unit/queue.test.ts` | Unit tests verifying the factory contract (REDIS_URL gating, default job options, close idempotency). |
| `docker-compose.yml` | New `worker` service sharing the API image; entrypoint is `pnpm --filter @sjms/server worker` instead of the HTTP server. |
| `server/package.json` | Adds `bullmq@^5.40.0` dependency and `worker` / `worker:dev` scripts. |

## Design choices

1. **Real Redis required.** BullMQ relies on Lua scripts and blocking commands; the no-op redis shim in `utils/redis.ts` cannot satisfy that. The factories throw a clear error when `REDIS_URL` is unset rather than silently degrading.
2. **Separate connections per queue / worker.** BullMQ requires `maxRetriesPerRequest: null` on worker connections (so blocking BRPOPLPUSH doesn't give up). That's incompatible with the rate-limit client's 3-retry setting, so workers get their own connections.
3. **Cached factories.** `getQueue(name)` returns the same Queue instance per process. Call sites don't have to thread the queue through their service layer.
4. **Sensible defaults.** Every job gets `attempts: 5`, exponential 60s backoff, 7-day completed retention (1000 jobs max), 30-day failed retention. Tuned for outbox-style work; individual `add()` calls can override.
5. **Graceful shutdown.** `closeAllWorkers()` + `closeAllQueues()` drain every BullMQ resource the process created. The worker entry-point binds them to SIGTERM/SIGINT so Kubernetes / Railway / Render preStop hooks complete cleanly.

## Deployment matrix (KI-S5-201)

| Target | Worker supported? | Notes |
|---|---|---|
| Vercel Functions | No | No long-running processes. The Vercel deploy runs only the API + client. |
| Local docker-compose | Yes | The new `worker` service; `docker-compose up worker` runs it alongside API. |
| Railway | Yes | Deploy the same Dockerfile with the override `command: pnpm --filter @sjms/server worker`. Each environment gets its own worker service. |
| Render | Yes | "Background Worker" service type with the same command override. |
| Fly | Yes | `[processes] worker = "pnpm --filter @sjms/server worker"` in fly.toml. |
| Local always-on VM | Yes | `npm run --workspace=server worker` after `pnpm install`. |

## What 0D does NOT do

- **The outbox table + dispatcher.** That's batch 0L. This PR is just the worker plumbing 0L will land on top of.
- **Queue monitoring / metrics.** A Prometheus scraper exposing queue depth + failed counts is sequenced to 0L's metrics endpoint.
- **A Bull-Board admin UI.** Phase 21 portal-completion can layer one if operators ask for it.
- **Choice of worker host.** Per KI-S5-201, the operator picks Railway / Render / Fly / VM at the start of Phase 1. Not Phase 0's call.

## Verification

```
$ pnpm exec vitest run src/__tests__/unit/queue.test.ts
✓ src/__tests__/unit/queue.test.ts (6 tests) 395ms

Test Files  1 passed (1)
     Tests  6 passed (6)
```

- `getQueue / createWorker / getQueueEvents` throw a clear error when `REDIS_URL` is unset.
- `DEFAULT_JOB_OPTIONS` exposes the documented `attempts / backoff / removeOnComplete / removeOnFail` shape.
- `closeAllWorkers / closeAllQueues` are safe to call when no workers have been spawned (idempotent).
- `QUEUE_NAMES.OUTBOX_EVENTS` is exported for batch 0L to import without typos.

Integration test against a real Redis (round-trip a noop job, drain) is sequenced to batch 0L where the outbox worker first needs it.

## Acceptance signal

Closes batch 0D per the Phase 0 build queue. Unblocks 0L (which builds the OutboxEvent dispatcher on top of this).
