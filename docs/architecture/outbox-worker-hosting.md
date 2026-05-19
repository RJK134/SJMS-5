# Outbox Worker Hosting — Design Note

> **Status:** **Draft for operator approval (2026-05-18).** Once approved, this
> document is the canonical reference for Phase 0 batches 0D (BullMQ worker pattern)
> and 0L (transactional outbox + worker) and the deployment topology for every
> long-running process in SJMS-5 until Phase 12 pilot readiness revisits hosting.
>
> **Author:** Claude (Opus 4.7) acting as solution architect for the operator-
> approved next-session work after the 2026-05-18 overnight Phase 0 build.
>
> **Reading order:** §1–§4 are the decision; §5–§9 are the implementation contract
> for the next session; §10–§12 are the operator approval surface.

---

## 1. Problem statement

Two Phase 0 batches need a long-running process that **cannot** run on Vercel:

- **0L — transactional outbox + worker** (per [`SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) §2). New `OutboxEvent` Prisma model is written inside every mutation's Prisma transaction; a separate worker process drains it with at-least-once semantics, exponential backoff to 2,048s, `DEAD` after 12 attempts, surfaced via `GET /api/v1/admin/outbox`.
- **0D — BullMQ + Redis worker pattern** (per [`SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) Phase 0). Used for the Phase 1E finance-ledger anomaly detector, Phase 3 HESA XML batch generators, Phase 7 Moodle sync jobs, and the Phase 8 n8n communication queues.

Both share one infrastructure dependency: **a process that stays running between requests**.

Per [`SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) §13:

> Vercel deploys the API server as a serverless function — there is **no startup hook**. Anything that must happen once per deploy goes in the build command (`server/vercel.json`), not `npm start`. BullMQ workers do **not** run on Vercel (no long-running process). Workers run on a dedicated long-running host (Railway / Render / Fly) that dequeues from the same Redis used by the API. The Vercel-hosted API only enqueues.

KI-S5-201 in [`SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md) carries the same constraint as a deliberate deferred-resolution item, target "Phase 0 — deploy workers to Railway/Render/Fly".

This note picks the host, sizes it, defines the deploy topology, and lists the operator-decision surface that has to ratify before 0D or 0L lands.

## 2. Constraints

| Constraint | Source |
|---|---|
| Worker must run as a long-running process (not serverless) | Operating model §13 |
| Worker must connect to the **same** Redis the API uses (single backing instance for now) | Plan amendments §2.3 |
| Worker must connect to the **same** Postgres (Neon) the API uses, via `DATABASE_URL` for the outbox read + Prisma client `$transaction` semantics | 0L brief; Plan amendments §2.2 |
| Worker must call out to n8n (`WEBHOOK_BASE_URL`) with the corrected `x-internal-service-key` header from 0H | 0L brief; Plan amendments §3 |
| Operator runs no local Docker / npm / prisma — every deploy via push to `main` and host-side auto-build | Operating model §13 |
| Per-purpose Redis namespacing (rate-limit / cache / outbox / BullMQ) is **Phase 10** work, not Phase 0 | KI-S5-319 |
| Solo operator — must be feasible for one person to deploy, observe, and rotate secrets on | Operating model §13 |

## 3. Decision — chosen host: **Railway**

### 3.1 Recommendation

Deploy the worker to **Railway** ([railway.com](https://railway.com)) as the long-running host for Phase 0–11. Re-evaluate at Phase 12 (pilot readiness) once two-tenant staging is live and the cost/operability picture from real load is in hand.

### 3.2 Why Railway over Render and Fly

| Factor | Railway | Render | Fly |
|---|---|---|---|
| Push-to-main → auto-deploy from GitHub | ✅ native | ✅ native | ✅ via Fly Launch |
| Per-service env vars + secret rotation in UI | ✅ | ✅ | ⚠️ CLI-only by default |
| Postgres-on-the-same-network as worker | ✅ if Neon-via-pooler over public TLS; Railway Postgres add-on is also one click | ✅ same | ✅ same |
| Single managed Redis on the same project | ✅ Railway Redis add-on; same project, internal network | ✅ Render Key Value | ⚠️ Upstash external recommended |
| Solo-operator UX (no Docker required client-side) | ✅ Nixpacks auto-detects Node | ✅ native | ⚠️ Dockerfile preferred |
| Free / hobby tier suitable for pre-pilot | ⚠️ no free tier; ~$5/month Hobby + ~$5/month metered | ✅ free tier (with cold-start trade-off) | ✅ free tier (with warm-machine $1.94/month per worker) |
| British-data-residency option | ✅ `eu-west2` (London) region | ✅ `Frankfurt` | ✅ `lhr` (London) |
| Built-in Prometheus / metrics scrape | ⚠️ via add-on; we ship `/metrics` over HTTP anyway | ⚠️ via add-on | ⚠️ via add-on |
| Vendor-lock-in risk | Low — pure Node process, no Railway-specific APIs | Low — same | Low — same |

**Decision rationale:** Railway wins on solo-operator UX + push-to-deploy ergonomics. Fly wins on cost-at-rest if the team is comfortable with `flyctl`. Render wins if the operator wants a free tier today; the cold-start trade-off makes it the wrong fit for an outbox worker that must process events with sub-30s latency (the very condition we built the outbox to fix).

**Cost estimate (Phase 0–11):**

- Railway Hobby plan: $5/month base
- Workers: 1 vCPU / 512 MiB × 1 instance ≈ $5–8/month metered (worker is light — polls every 1s, calls Prisma, calls n8n)
- Railway Redis add-on (10 MB): included on Hobby
- Total: **~£10–15/month** pre-pilot. Sized to scale to ~£50/month at two-tenant staging.

If Railway costs surprise on the bill, switching to Fly is a ~half-day swap because the worker code is pure Node + ioredis + Prisma — no Railway-specific imports.

### 3.3 Out of scope (revisit at Phase 12)

- **Per-tenant worker pools.** Phase 2 multi-tenancy lands first; pool fan-out is a Phase 12 hardening task.
- **Multi-region active-active.** Single region (`eu-west2`) is sufficient for the UK HE pilot.
- **Cosign-signed worker images.** That is Phase 12 (12K) per the build queue.

## 4. Deploy topology

```
                       ┌──────────────────────────────────────┐
                       │            Vercel (eu-west)          │
                       │   ┌──────────────────────────────┐   │
                       │   │  SJMS-5 API (serverless fn)  │   │
                       │   │  enqueue → outbox via Prisma │   │
                       │   │  enqueue → BullMQ via Redis  │   │
                       │   └─────────────┬────────────────┘   │
                       └─────────────────┼────────────────────┘
                                         │
                                         │ TLS (DATABASE_URL pooled +
                                         │ REDIS_URL via rediss://)
                                         │
                       ┌─────────────────┴────────────────────┐
                       │              Neon (eu-west2)         │
                       │   Postgres 16 — sjms_app schema      │
                       │   OutboxEvent table indexed on       │
                       │   (status, createdAt)                │
                       └─────────────────┬────────────────────┘
                                         │
                                         │ (same DATABASE_URL)
                                         │
                       ┌─────────────────┴────────────────────┐
                       │           Railway (eu-west2)         │
                       │   ┌──────────────────────────────┐   │
                       │   │ sjms5-worker (Node 20)       │   │
                       │   │ - server/src/workers/        │   │
                       │   │     outbox-worker.ts         │   │
                       │   │ - BullMQ worker bootstrap    │   │
                       │   │ - exposes :3002/metrics      │   │
                       │   └─────────────┬────────────────┘   │
                       │   ┌─────────────┴────────────────┐   │
                       │   │ Redis 7 (Railway add-on)     │   │
                       │   │ Used for: BullMQ queues +    │   │
                       │   │ rate-limit + future cache    │   │
                       │   └──────────────────────────────┘   │
                       └─────────────────┬────────────────────┘
                                         │
                                         │ HTTPS POST + x-internal-service-key
                                         │
                       ┌─────────────────┴────────────────────┐
                       │            n8n (self-hosted)         │
                       │  receives /webhook/sjms/*            │
                       │  triggers workflows per EVENT_ROUTES │
                       └──────────────────────────────────────┘
```

**Two physical processes, one logical app.** The repo ships both; Vercel runs `npm start --workspace server` (or whatever `vercel.json` resolves) and Railway runs `npm run worker --workspace server`. The same `server/src/` source tree powers both. Differences are entirely in entry point.

## 5. Worker process specification

Echoes the 0L brief in [`SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) and [`SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) §2 with the host-side detail filled in:

### 5.1 Entry point

`server/src/workers/index.ts` — boots three subsystems in parallel and shares one process:

1. **`outbox-worker.ts`** — polls every 1 s, claims rows via `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`, marks `IN_PROGRESS`, calls the existing webhook signing logic, exponential backoff per the brief, `DEAD` after 12 attempts.
2. **`bullmq-bootstrap.ts`** — registers BullMQ Workers for the queues that Phase 1+ services enqueue against. Today: empty (Phase 0 ships only the scaffolding); Phase 1E adds `finance-anomaly`; Phase 3 adds `hesa-xml`; Phase 7 adds `moodle-sync`.
3. **`metrics-server.ts`** — Express app on `PORT=3002` exposing `/metrics` (Prometheus format) + `/health`. Required so Railway's healthcheck can poll, and so the Phase 10 Prometheus scrape can read the new outbox gauges.

### 5.2 Configuration

Single set of env vars (same shape Railway service config uses):

| Variable | Source | Purpose |
|---|---|---|
| `DATABASE_URL` | Neon pooled endpoint | Prisma client for outbox read + ledger write |
| `DIRECT_URL` | Neon unpooled endpoint | Prisma migrate (not used at runtime by worker; included for parity with API) |
| `REDIS_URL` | Railway Redis add-on (internal `rediss://...`) | BullMQ + future cache |
| `WEBHOOK_BASE_URL` | n8n base URL | outbox-worker POST target |
| `INTERNAL_SERVICE_KEY` | shared with API | `x-internal-service-key` header value |
| `NODE_ENV=production` | static | Disables dev guards |
| `LOG_LEVEL=info` | static | Winston level |
| `OUTBOX_BATCH_SIZE=100` | static (overridable) | per-poll claim limit |
| `OUTBOX_POLL_INTERVAL_MS=1000` | static | matches the 1 s acceptance criterion |
| `OUTBOX_MAX_ATTEMPTS=12` | static | matches the 12-attempt DEAD threshold |
| `PORT=3002` | Railway-injected | metrics server port |

No new secrets vs the API. The worker is the API process minus HTTP listeners plus the poll loop.

### 5.3 Healthcheck

`GET http://localhost:3002/health` returns:

```json
{
  "status": "ok",
  "uptimeSeconds": 123,
  "lastPolledAt": "2026-05-18T22:30:00Z",
  "lastDeliveredAt": "2026-05-18T22:29:42Z",
  "pendingOutboxEvents": 3,
  "deadOutboxEvents": 0
}
```

Railway healthcheck calls this every 30 s with a 10 s timeout. Failure for >3 consecutive checks → Railway restarts the service.

### 5.4 Prometheus surface

Per the 0L brief, exposes:

- `sjms_outbox_pending_total{tenant,event}` — gauge
- `sjms_outbox_dead_total{tenant,event}` — counter
- `sjms_outbox_attempts_histogram_bucket` — histogram of delivery attempt counts before success
- `sjms_outbox_delivery_duration_seconds` — histogram of end-to-end outbox → n8n round-trip

Plus the BullMQ standard pack:

- `bullmq_queue_completed_total{queue}`
- `bullmq_queue_failed_total{queue}`
- `bullmq_queue_active{queue}`
- `bullmq_queue_waiting{queue}`

## 6. Redis configuration

**Phase 0 posture: single Redis instance, no per-purpose namespacing.** Per [KI-S5-319](../SJMS-5-KNOWN-ISSUES.md) the per-purpose namespacing pass is Phase 10 work alongside observability. For Phase 0:

- Rate-limit counters live under prefix `rl:` (already in `server/src/middleware/rate-limit.ts`).
- BullMQ queues use default prefix `bull` (BullMQ default).
- Future cache (Phase 7+) will use `cache:`.

The default keyspace coexistence is fine at our scale. Phase 10 will split into separate Redis instances or use Redis ACL keyspace isolation.

**Eviction:** Redis is configured with `--maxmemory-policy noeviction`. We never want BullMQ jobs evicted under memory pressure — the outbox already protects against silent loss; BullMQ should fail loud if Redis hits its limit, not silently drop jobs.

## 7. Failure modes + recovery

| Failure | Detection | Recovery |
|---|---|---|
| Worker crashes mid-poll | Railway healthcheck fail → restart | Worker boots clean; `IN_PROGRESS` rows that the dead process held are reclaimed by the next poll cycle after the lock expires (Postgres `FOR UPDATE` releases on transaction abort) |
| Redis unreachable | Worker `/health` reports `pendingOutboxEvents` increasing without delivery; alert on `sjms_outbox_pending_total{tenant="fhe"} > 1000` for 5min | Investigate Redis; queue drains automatically when Redis recovers |
| n8n unreachable | Outbox events retry per exponential backoff; alert on `sjms_outbox_dead_total > 0` | Investigate n8n; SUPER_ADMIN replays dead events via `POST /api/v1/admin/outbox/:id/replay` |
| Postgres unreachable | Worker errors; Railway healthcheck fail; restart loop | Investigate Neon; worker resumes when Postgres recovers |
| Worker silently stops polling but doesn't crash | `lastPolledAt` in `/health` more than 10s stale | Manual restart via Railway dashboard; root-cause investigation |
| Outbox poison message | One event repeatedly fails delivery; reaches DEAD after 12 attempts (~34 min total) | Surfaces in `GET /api/v1/admin/outbox?status=DEAD`; operator investigates payload or n8n endpoint |

## 8. Operability commitments

- **Runbook** at `docs/operations/event-delivery-runbook.md` (per 0L brief) — covers the failure modes above plus replay procedure.
- **Prometheus alert rules** in `docker/prometheus/alerts/outbox.yml` (per Phase 10 (10F) plan but seeded in 0L). Alerts: pending > 1000 for 5 min; dead > 0; lastPolledAt stale > 30 s.
- **Logging:** Winston JSON with `service: 'worker'` tag so log aggregator can split worker vs API.
- **Secrets rotation:** `INTERNAL_SERVICE_KEY` rotates via Railway dashboard + a parallel Vercel env-var update; the n8n credential `SJMS Internal API` rotates simultaneously.

## 9. Rollback plan

If 0L + 0D rollback is needed:

1. **Disable the worker** — Railway dashboard, pause the service. The API keeps writing `OutboxEvent` rows but they remain `PENDING`.
2. **Revert the `emitEvent` call sites** in `server/src/utils/webhooks.ts` to the pre-0L synchronous POST behaviour. Single commit on a `fix/revert-0l-emit` branch.
3. **Drain the backlog** by restarting the worker once the revert is debugged — or by manual replay of the PENDING rows via a one-off script.
4. **Leave the `OutboxEvent` model in place** — the rows are useful audit history even if the worker is paused.

The single-commit revert + drain-on-restart pattern keeps blast radius bounded.

## 10. Decisions the operator must ratify before code lands

| # | Decision | Default if no objection |
|---|---|---|
| 1 | Worker host platform | **Railway** (per §3) |
| 2 | Worker hosting region | **eu-west2** (London) for UK HE data-residency |
| 3 | Redis topology | **Single Railway Redis add-on**, shared across all purposes for Phase 0; per-purpose split in Phase 10 |
| 4 | Worker scaling | **1 instance, 1 vCPU, 512 MiB** at Phase 0; horizontal autoscaling deferred to Phase 12 |
| 5 | BullMQ queue prefix | **Default `bull`** for Phase 0; namespaced split at Phase 10 |
| 6 | Cost ceiling alert | **£25/month** alert via Railway billing notifications; bumps to £100/month for two-tenant staging |
| 7 | Worker repo path | Worker code lives at `server/src/workers/` in the **same repo** as the API (one source tree, two entry points); no separate `sjms-5-worker` repo |
| 8 | Deploy gate | Railway auto-deploys on push to `main` after CI green — gated by the same branch protection §2 rules as the Vercel deploy |
| 9 | Initial outbox payload size cap | **256 KiB per row** (BigInt-friendly, well under Postgres JSONB practical limit); enforced at `emitEvent` schema validation |
| 10 | DEAD-event retention | **90 days** before background pruning; aligns with the dataset audit-evidence 90-day default already in `lake-drift-detector.yml` |

If the operator wants to override any default, record the decision in a one-line edit to §10 and commit a follow-on amendment.

## 11. Implementation sequence — one coordinated session

Both batches in a single overnight run, stacked on `phase-0/spine-import`:

1. **0D first** (~1 hr) — add BullMQ dependency, scaffold `server/src/workers/index.ts` + `bullmq-bootstrap.ts` + `metrics-server.ts`, add `npm run worker` script, write a no-op BullMQ job that round-trips end-to-end, add Prometheus gauges, draft the `event-delivery-runbook.md` skeleton. PR opens as draft.

2. **0L immediately on top** (~3 hr) — add the `OutboxEvent` Prisma model + migration, refactor `server/src/utils/webhooks.ts` so `emitEvent(payload, tx)` writes the outbox row in the caller's transaction, walk every call site in `server/src/api/*/` to thread `tx`, build the `outbox-worker.ts` polling loop, add the `GET /api/v1/admin/outbox` + replay endpoints, wire the Prometheus gauges, expand the runbook with the failure-mode procedures. PR opens as draft, stacked on the 0D PR.

3. **Operator review** — both PRs reviewed together. Squash-merge in order (0D then 0L) so the worker scaffolding lands before the worker has anything to drain.

4. **Railway deploy** — operator creates the Railway project, sets env vars per §5.2, sets up the GitHub auto-deploy connection. First deploy is the empty BullMQ surface from 0D; second deploy (after 0L lands) adds the outbox polling.

5. **End-to-end smoke** — operator triggers a known mutation in the API (e.g. `POST /v1/students` against a test record), confirms the `OutboxEvent` row appears, the worker picks it up within ~2 s, n8n receives the webhook with the correct `x-internal-service-key` header, and the row flips to `DELIVERED`. Records the round-trip in `evidence/phase-0/0l-outbox-smoke.md`.

After both merge, **Phase 0 has only 0C + 0I + 0N left** (cryptobox, CI green, Dependabot+BugBot), all of which are decoupled and can ship in any order. Phase 1 then unblocks immediately.

## 12. References

- [`docs/SJMS-5-SYNTHESIS-PLAN.md`](../SJMS-5-SYNTHESIS-PLAN.md) — original plan
- [`docs/SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) §2 — outbox specification
- [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) §13 — operator + worker hosting constraint; §14 — auto-merge policy
- [`docs/SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) — Phase 0 0L + 0D briefs
- [`docs/SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md) — KI-S5-201 (worker host), KI-S5-301 (outbox), KI-S5-314 (n8n circuit breaker subsumed by outbox), KI-S5-319 (Redis namespacing → Phase 10)
- [`docs/skills-leads/01-phase-0-spine-import.md`](../skills-leads/01-phase-0-spine-import.md) — Spine Import Lead acceptance criteria
- [Railway docs — Nixpacks Node detection](https://docs.railway.com/guides/nixpacks)
- [Railway docs — Redis add-on](https://docs.railway.com/guides/databases)
- BullMQ — [Worker concurrency + concurrency-per-worker](https://docs.bullmq.io/guide/workers/concurrency)
