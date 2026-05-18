# SJMS 2.5 — Vercel + Neon Deployment Runbook

> **Last updated:** 2026-05-12
> **Scope:** Operating the Vercel-hosted client + API and the Neon-hosted Postgres for the production SJMS 2.5 deployment.
> **Companion docs:** `docs/STAGING-RUNBOOK.md` (Docker Compose self-host), `.env.example` (full variable reference).
> **Migration note:** the previous Railway-hosted Express server + Railway Postgres deployment was retired on 2026-05-12. The git history retains the prior `docs/RAILWAY-RUNBOOK.md` (commit before the rename) for reference if you need to recover any of its operational detail.

---

## 1. Architecture summary

```
 Vercel (sjms-2-5-client)         Vercel (server project)
┌──────────────────────────┐    ┌──────────────────────────────────┐
│  Vite SPA, served from   │    │  Express + Prisma + Node 20      │
│  client/dist/            │    │  Deployed as a separate Vercel   │
│                          │    │  project, or as @vercel/node     │
│  API origin from         │───▶│  functions in the same project   │
│  VITE_API_URL (§3.3)     │    │  /health  → liveness             │
│                          │    │  /api/health → readiness (DB)    │
└──────────────────────────┘    │  /api/v1/*   → 57 routers        │
                                │  /metrics, /api/docs (gated)     │
                                └────────────┬─────────────────────┘
                                             │ pooled Postgres
                                             │ connection (PGBouncer)
                                ┌────────────▼─────────────────────┐
                                │  Neon Postgres                   │
                                │  schema: sjms_app                │
                                │  Branch DBs cloned per Vercel    │
                                │  preview (recommended pattern)   │
                                │  Migrations applied on every     │
                                │  Vercel server-side deploy       │
                                └──────────────────────────────────┘
```

The Vercel frontend has **no direct database access**. All reads/writes go through the Vercel-hosted Express API. If the API project is down, the frontend loads but every `/api/*` call returns 502/504 from Vercel's edge.

---

## 2. First-time Vercel provisioning

### 2.1 Vercel projects

Two Vercel projects (recommended for clean separation of concerns):

- **`sjms-2-5-client`** — the React/Vite SPA. Root directory `client`. Framework preset Vite. Output `dist`.
- **`sjms-2-5-server`** — the Express API. Root directory `server`. Framework preset Other. Build via `npm run build` (which runs `prisma generate` + `tsc`). Runtime is `@vercel/node` long-running, or a serverless-function wrapper if you prefer that pattern. Both work — pick once and stick with it.

If you would rather keep a single project and run the API as an `api/` directory of serverless functions in the same project as the client, that is supported but requires wrapping `server/src/index.ts` Express app via `@vercel/node` and exporting the handler from `api/[...].ts`. In that layout, Vercel routes `/api/*` to the in-repo functions natively — no `vercel.json` rewrite is needed. Set `VITE_API_URL=/api` per Vercel environment so the client emits same-origin relative requests; CORS becomes irrelevant.

### 2.2 Build and start commands

| Project | Setting | Value |
|---|---|---|
| Client | **Root Directory** | `client` |
| Client | **Build Command** | `npm run build` *(inherited from `vercel.json`)* |
| Client | **Output Directory** | `dist` |
| Client | **Install Command** | `npm ci` (run at repo root so workspaces resolve) |
| Server | **Root Directory** | `server` |
| Server | **Build Command** | inherited from `server/vercel.json` — `npm run build && npx tsx ../scripts/deploy-init.ts` |
| Server | **Output Directory** | *(blank — Vercel auto-detects `dist/`)* |
| Server | **Node Version** | 20.x |

**Where the seed actually runs on Vercel.** The server is bundled as a
**serverless function** when deployed to Vercel — Vercel never invokes
`npm start`, it just snapshots `dist/` and invokes the exported Express
app per-request. That means migrations and seeding **must happen at
build time**, not at server start. The `server/vercel.json` build command
chains `deploy-init.ts` after `npm run build` for exactly this reason:

1. `npm run build` → `prisma generate && tsc` produces `dist/`.
2. `npx tsx ../scripts/deploy-init.ts` then:
   a. Logs the redacted DATABASE_URL and DIRECT_URL so you can confirm the
      build is hitting the expected Neon branch — this appears in the
      Vercel **Build Logs**, not Runtime Logs.
   b. Runs `prisma migrate deploy` against `DIRECT_URL` if set (falling
      back to `DATABASE_URL`).
   c. Runs `npm run db:seed` when row counts indicate the database is not
      fully seeded — specifically, when **either** the Person count is
      zero **or** the Programme count is zero (the partial-seed guard).
      The `_seed_completed_at` SystemSetting marker is read for
      observability but is not on its own sufficient to skip seeding.
      `FORCE_SEED=true` bypasses the skip.
   d. Prints post-seed row counts so you can see in the Build Logs
      exactly what landed.

The seed step is non-fatal — if it fails, the build still succeeds so the
server can boot and serve `/api/health`. Migration failures, however, do
fail the build (you cannot ship a server pointed at an un-migrated DB).
A missing `DATABASE_URL` at build time is also fatal on Vercel.

Docker / long-running deploys still call `tsx ../scripts/deploy-init.ts &&
node dist/index.js` via `npm start`, so the same behaviour applies there.

### 2.3 Required environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, scoped per environment (Production / Preview / Development). Vercel evaluates env vars at build and runtime according to the active environment.

**All values marked "Hard" must be set or the server will fail to start (or boot in an insecure state).**

| Variable | Severity | Value | Scope | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | **Hard** | `postgres://<user>:<pwd>@<neon-host>/<db>?sslmode=require&schema=sjms_app` | Server, all envs | Neon-issued **pooled** connection string for the runtime OR any Postgres URL for non-Neon hosts. Append `?schema=sjms_app` so Prisma uses the right schema. |
| `DIRECT_URL` | **Hard** | unpooled Neon connection string (or duplicate `DATABASE_URL` locally) | Server, all envs | Required whenever `directUrl` is set in `schema.prisma`: Prisma 6 refuses `validate` / `generate` / `migrate` if this env var is missing (P1012). On Neon, use the **direct** (unpooled) host here while `DATABASE_URL` stays on the pooler. For Docker Compose without PgBouncer, set `DIRECT_URL` identical to `DATABASE_URL`. |
| `NODE_ENV` | **Hard** | `production` | Server, Production | Triggers the production branches of the auth, CORS, metrics, docs, and logger modules. Vercel sets this automatically on Production; double-check Preview is `production` too if you want production-equivalent behaviour. |
| `CORS_ORIGIN` | **Hard** | `https://sjms-2-5-client.vercel.app,https://<custom-domain>` | Server, all envs | Comma-separated allow-list of Vercel domains. **Empty value rejects all CORS preflights from the frontend.** Include each Vercel preview's wildcard pattern if you want preview-to-preview CORS to work — Vercel previews follow `https://sjms-2-5-client-<branch>-<team>.vercel.app`. |
| `WEBHOOK_SECRET` | **Hard** | *(generate)* | Server, all envs | The server **throws at startup** in non-dev environments if this is missing or too short. Generate via:<br>`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `INTERNAL_SERVICE_KEY` | **Hard** | *(generate)* | Server + smoke CI | Min 32 chars. Used by the smoke-check workflow and by future n8n integrations to authenticate as a service. Same generator as above. **Must NOT be the dev placeholder.** Set the same value as a GitHub Actions secret named `INTERNAL_SERVICE_KEY` so the smoke check authenticates. |
| `JWT_SECRET` | **Hard** | *(generate)* | Server, all envs | Static-JWT fallback signing key. Same generator. Will be retired in Phase 23 once Keycloak is the sole issuer. |
| `DEMO_MODE` | Conditional | `true` | Server, Preview (and Production only for stakeholder demos) | When set, every request authenticates as a synthetic `demo-admin` with all 36 roles. Required while Keycloak is not yet provisioned. **Never enable on a server that holds real student / staff / financial data.** Watch the boot log for `[DEMO_MODE] Authentication bypass enabled - DO NOT USE IN PRODUCTION WITH REAL DATA`. |
| `LOG_LEVEL` | Soft | `info` | Server | Defaults to `info` if unset. |
| `WEBHOOK_BASE_URL` | Soft | *(blank until n8n provisioned)* | Server | Defaults to `http://localhost:5678`. Outgoing webhooks fail silently and are queued for retry; do not block service start. |
| `REDIS_URL` | Soft | *(if Redis service added)* | Server | Without Redis (or when Redis errors), the custom `RedisStore` in `server/src/middleware/rate-limit.ts` returns a permissive `{ totalHits: 1 }` response on every increment, which **effectively disables rate limiting** rather than falling back to a per-instance in-memory counter. Acceptable for single-instance demos where Vercel's edge is the practical rate limiter; provision Redis (e.g. Upstash) for any hardened deployment. |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | Conditional | *(when Keycloak is provisioned)* | Server, all envs | Required only when the frontend switches to `VITE_AUTH_MODE=keycloak`. |
| `VITE_API_URL` | **Hard** | `https://<server-hostname>/api` | Client, all envs | Absolute API origin. **Must be set per Vercel environment** in the dashboard. There is no `vercel.json` default and no rewrite — the client emits absolute requests to this hostname (see §3.3). Typical value: `https://sjms-2-5-server.vercel.app/api` for Production; the preview alias (e.g. `https://sjms-2-5-server-<branch>-<team>.vercel.app/api`) for Preview. Local dev does not need this set — Vite's `server.proxy["/api"]` in `client/vite.config.ts` forwards `/api/*` to `http://localhost:3001`. |
| `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID` | Conditional | *(when Keycloak is provisioned)* | Client, all envs | Set per Vercel environment in the dashboard. **Not** baked into `vercel.json` — the operator owns this. |
| `VITE_AUTH_MODE` | Soft | `dev` (Preview), `keycloak` (Production, once Keycloak lands) | Client | Per-environment override (Vercel dashboard) takes precedence over the `vercel.json` default. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Conditional | *(Phase 20)* | Server | Required for Communications email delivery; the wiring lands in Phase 20. Until then leave blank. |

### 2.4 First deploy — what to watch in the logs

Vercel exposes two log streams per deployment:

- **Build Logs** — the output of `npm ci && npm run build` for the project being deployed. Failures here block the deploy.
- **Runtime Logs / Function Logs** — emitted by the running service. For a Node long-running deployment of the server, these are stdout/stderr lines; for the @vercel/node serverless function pattern, each request gets a log group.

Tail with `vercel logs <deployment-url>` from the CLI, or open the deployment in the Vercel dashboard and switch to the **Logs** tab.

You should see, in the server's **Build Logs** (NOT Runtime Logs — see
§2.2 for why), on first deploy after a fresh Neon branch:

```
[deploy-init] Running at BUILD time on Vercel.
[deploy-init] DATABASE_URL → postgres://***:***@ep-foo.neon.tech/sjms schema=sjms_app
[deploy-init] DIRECT_URL   → postgres://***:***@ep-foo-unpooled.neon.tech/sjms ...
[deploy-init] Running prisma migrate deploy...
Applying migration `20260120_phase4_data_model_enhancements`
... (further migrations) ...
All migrations have been successfully applied.
[deploy-init] Acquiring seed-guard advisory lock...
[deploy-init] Checking whether the database is fully seeded...
[deploy-init] Database not fully seeded (persons=0, programmes=0) — running seed...
[seed] ... (seed output) ...
[deploy-init] Post-seed row counts: persons=850, programmes=12, students=420, enrolments=412
[deploy-init] Seed complete.
```

Runtime Logs (a separate tab in Vercel) only contain the per-request lines
from the running serverless function — `GET /api/v1/students 200 ...` and
similar. They will **not** show the `[deploy-init]` lines; those are
build-time output. If the Build Logs show no `[deploy-init]` lines at all
(only `prisma generate && tsc`), the build command in Vercel's project
settings has overridden `server/vercel.json` — fix it via Settings → Build
and Deployment → Build Command, or delete the override so the repo's
`server/vercel.json` takes effect.

If you see `Database appears seeded` on a **fresh** deploy, a `_seed_completed_at` row from a previous environment survived but the data did not — wipe the Neon database (or the relevant branch) and redeploy, or delete that `system_settings` row manually.

### 2.5 Health verification

After the deploy completes, run from any machine:

```bash
API_URL=https://<your-server-project>.vercel.app

# Liveness — must return 200 with { status: "ok" }
curl -fsS "$API_URL/health"

# Readiness — must return 200 with checks.database = "connected"
curl -fsS "$API_URL/api/health"

# Authenticated smoke test (replace with real INTERNAL_SERVICE_KEY)
curl -fsS \
  -H "X-Internal-Service-Key: $INTERNAL_SERVICE_KEY" \
  "$API_URL/api/v1/students?limit=5" | jq '.data | length'
# Expected: a small integer >0 (typically 5)
```

### 2.6 Smoke check workflow

Once the service is up, configure the GitHub Actions smoke check:

1. Repository → Settings → Secrets and variables → Actions:
   - **Variable** `PREVIEW_API_URL` = `https://<your-server-project>.vercel.app`
   - **Secret** `INTERNAL_SERVICE_KEY` = the same value set in Vercel
2. Manually trigger `.github/workflows/preview-smoke.yml` from the Actions tab.
3. The workflow asserts `>100` students are returned. If it fails:
   - 401/403 → key mismatch.
   - 404 → wrong `VITE_API_URL`, API routing, or CORS (verify `/api/v1/students` exists on the server project).
   - `<100 students` → seed did not run; check Vercel **Build Logs** (the seed runs at build time on Vercel — see §2.2).

---

## 3. Vercel configuration

### 3.1 Project settings

| Setting | Client | Server |
|---|---|---|
| **Framework Preset** | Vite | Other |
| **Root Directory** | `client` | `server` |
| **Build Command** | `npm run build` *(inherited from `vercel.json`)* | `npm ci && npm run build` |
| **Output Directory** | `dist` *(inherited from `vercel.json`)* | *(auto)* |
| **Install Command** | `npm ci` | `npm ci` |
| **Node version** | 20.x | 20.x |

### 3.2 Per-environment auth mode

`vercel.json` ships with `VITE_AUTH_MODE=dev` as a default. **Override per environment** in Vercel → Project Settings → Environment Variables:

| Environment | `VITE_AUTH_MODE` | Notes |
|---|---|---|
| **Preview** (PR previews) | `dev` | Persona-based bypass; appropriate for internal demos. |
| **Production** | `keycloak` *(once Keycloak is provisioned)* | Real OIDC PKCE flow. Requires `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID` to be set. |

The `vercel.json` `env` block sets defaults that are **overridden** by per-environment values in the Vercel dashboard.

### 3.3 Backend URL — env-driven, no hardcoded hostnames

**Canonical pattern.** The client reads `VITE_API_URL` at build time and emits absolute requests to that origin. There is **no `rewrites` block in `vercel.json`** — hostnames are not hardcoded in source. The operator configures `VITE_API_URL` per Vercel environment in Settings → Environment Variables:

| Vercel environment | `VITE_API_URL` |
|---|---|
| Production | `https://sjms-2-5-server.vercel.app/api` *(or your production server alias)* |
| Preview | `https://sjms-2-5-server-<branch>-<team>.vercel.app/api` *(per-PR alias)* — or a stable preview alias if you front previews with a single API |
| Development | *(unset — local dev uses Vite's `server.proxy` in `client/vite.config.ts` to forward `/api/*` to `http://localhost:3001`)* |

**Why this pattern.** Vercel rewrites are static string literals at deploy time; they do **not** support runtime `${ENV_VAR}` interpolation. Hardcoding a hostname in `vercel.json` couples the config to a single deployment URL and is the failure mode this PR retired. Env-driven `VITE_API_URL` keeps each Vercel environment configurable without source changes.

**CORS implication.** Because the client now emits cross-origin requests to the server (different `*.vercel.app` host), the server must allow the client's origin in `CORS_ORIGIN`. Update `CORS_ORIGIN` on the server's Vercel environment whenever a new client preview alias goes live, or use a CORS handler that accepts the wildcard pattern. The current server (`server/src/index.ts`) uses a fixed allow-list, so each new client origin must be appended.

**Same-project serverless alternative.** If the API is later moved into the client project as `api/[...].ts` serverless functions, Vercel routes `/api/*` to those functions natively — no rewrite needed. In that case set `VITE_API_URL=/api` per environment so the client emits relative requests; CORS is then irrelevant (same origin).

---

## 4. Neon Postgres operations

### 4.1 Branches

Neon supports **branch databases**: a low-cost copy-on-write clone of any existing branch. The recommended pattern for SJMS is:

- **`main` branch** — production database. Connected to the Vercel **Production** environment.
- **`preview` branch** (per PR) — created automatically by the Neon Vercel integration. Each Vercel preview deployment gets its own database branch so PR previews never touch production data.
- **`staging` branch** — long-lived; connected to Vercel Preview if the team chooses a single shared preview env instead of per-PR branches.

The Neon Vercel integration handles the wiring: in Neon → Project → Integrations → Vercel, link the SJMS Vercel server project. It will inject `DATABASE_URL` per Vercel environment automatically and clone the configured base branch when a new Vercel preview is created.

### 4.2 Connection pooling

Neon offers two endpoints per project:

- **Pooled** (PGBouncer, transaction mode) — use for the runtime `DATABASE_URL`. Survives bursts of short-lived connections, which Vercel's auto-scaling produces. **Add `?pgbouncer=true` to the URL** if Prisma reports prepared-statement collisions.
- **Direct** (unpooled) — use for `prisma migrate deploy` and any tooling that requires session-level state. Add as `DIRECT_URL` and reference from the `datasource` block in `prisma/schema.prisma`:

  ```prisma
  datasource db {
    provider  = "postgresql"
    url       = env("DATABASE_URL")
    directUrl = env("DIRECT_URL")
  }
  ```

With `directUrl` configured, Prisma 6 requires `DIRECT_URL` to be set for **every** Prisma CLI invocation (`validate`, `generate`, `migrate`, …). If it is missing, the CLI fails with `P1012` before opening a connection. For local Postgres without a pooler, set `DIRECT_URL` to the same value as `DATABASE_URL`.

### 4.3 Backups and PITR

Neon retains a continuous WAL log per branch and supports point-in-time restore. To recover from a bad migration:

1. Neon → Project → Branches → New branch from a timestamp before the bad migration.
2. Point the Vercel Production env's `DATABASE_URL` at the new branch.
3. Once the new branch is verified, rename the old `main` to `main-archive-YYYY-MM-DD` and promote the new branch to `main`.

---

## 5. Common operational tasks

### 5.1 Rolling back a bad deploy

Vercel keeps every deployment; rollback is one click:

1. Open the project in the Vercel dashboard.
2. Switch to the **Deployments** tab.
3. Click the three-dot menu on a known-good previous deployment.
4. Choose **Promote to Production**.

Do this **before** investigating the failure — a hung migrate-deploy step on the server side will leave the Production alias pointing at the bad build.

If a migration applied successfully but introduced a bug, roll back the application image **and** apply a corrective migration; **never** edit a migration that has been applied to production.

### 5.2 Forcing a re-seed (development/staging only)

```sql
-- Connect to the Neon console (or any psql with the DATABASE_URL)
DELETE FROM sjms_app.system_settings WHERE setting_key = '_seed_completed_at';
-- Optionally truncate person rows to force the count check to fall through
TRUNCATE TABLE sjms_app.persons CASCADE;
```

Then trigger a redeploy from Vercel (Deployments → Redeploy). **Do not run on production.**

If you are using Neon branch databases, the cleaner option is to delete the preview branch and let the Neon-Vercel integration recreate it from the configured base.

### 5.3 Inspecting webhook delivery failures

```bash
curl -fsS \
  -H "X-Internal-Service-Key: $INTERNAL_SERVICE_KEY" \
  "$API_URL/api/v1/webhooks?limit=20"
```

Failed deliveries land in the WebhookDelivery table with `status=FAILED`. The DLQ replay endpoint will be added in Phase 20.

### 5.4 Reading metrics

`/metrics` is gated behind SUPER_ADMIN in production. To scrape from a Prometheus instance, mint a token via the Keycloak admin console or use the internal service key:

```bash
curl -fsS \
  -H "X-Internal-Service-Key: $INTERNAL_SERVICE_KEY" \
  "$API_URL/metrics"
```

### 5.5 Reading API documentation

`/api/docs` is gated behind SUPER_ADMIN in production. In preview environments (where `NODE_ENV` is typically `production` on Vercel but the user base is internal), authenticate as a super-admin first.

For external API documentation that does not expose internal route names, generate a curated reference from `/api/docs/spec` and host it separately.

### 5.6 Reading logs

| What you want | Where |
|---|---|
| HTTP request lines, structured JSON | Vercel → Project → Deployment → **Runtime Logs** (long-running) or **Function Logs** (serverless) |
| Build failures | Vercel → Project → Deployment → **Build Logs** |
| Tail in terminal | `vercel logs <deployment-url> --follow` |
| Older than 24 h | Configure Vercel **Log Drains** to ship to Datadog/Loki/Logflare. Vercel's built-in retention is short (24 h on Hobby, longer on Pro). |
| Database errors | Neon → Project → Monitoring (slow queries, connections, errors) |

---

## 6. Restoration checklist

If the Vercel projects need to be reprovisioned from scratch:

- [ ] Provision the **client** project against `RJK134/SJMS-2.5`, root `client`, framework Vite.
- [ ] Provision the **server** project against the same repo, root `server`, framework Other.
- [ ] Install the **Neon Vercel integration**; link both projects so `DATABASE_URL` is injected per environment.
- [ ] Set all **Hard** environment variables from §2.3 (per project, per environment) — including `VITE_API_URL` per Vercel environment (§3.3).
- [ ] Trigger a manual deploy and watch the Build + Runtime Logs for the §2.4 sequence.
- [ ] Run §2.5 health checks against the server's Production URL; all three should succeed.
- [ ] Configure GitHub secrets and trigger §2.6 smoke check.
- [ ] In Vercel, confirm `VITE_AUTH_MODE=dev` for Preview env (or rely on the `vercel.json` default).
- [ ] Open the client's Production URL; navigate `/#/admin/dashboard`, `/#/student/dashboard`, `/#/applicant/dashboard`. Each should show real seeded data.

---

## 7. Known issues that affect Vercel + Neon operations

These are tracked in `docs/KNOWN_ISSUES.md`; cross-references here for visibility:

- **KI-P15-001** — npm audit baseline not yet triaged. Production deploy is permitted but supply-chain risk is unknown.
- **KI-P10b-002** — MinIO binary uploads not wired. Uploaded files fail silently on the frontend; document records hold metadata only.
- **`/api/docs` and `/metrics` were publicly unauthenticated prior to 2026-05-05** — closed by the production-readiness review commit (server gates both behind SUPER_ADMIN in production).
- **Webhook delivery to n8n** — until Phase 20 lands, `WEBHOOK_BASE_URL` should remain unset; the emitter retries 3 times then logs and continues. No data loss but no workflows execute.
- **Communications email delivery** — `communications.service.ts` records the request but does not send. Phase 20 wires SMTP delivery.

---

## 8. Pre-flight checklist for sharing with UAT colleagues

Before sharing the client's Vercel URL with a stakeholder:

- [ ] `/health` returns 200 (server project)
- [ ] `/api/health` returns `{ status: "ok", checks: { database: "connected" } }`
- [ ] Smoke check workflow last run is green
- [ ] Vercel preview/prod deployment is reachable and the home page loads
- [ ] Persona switching works: `/#/admin/dashboard`, `/#/student/dashboard`, `/#/academic/dashboard`, `/#/applicant/dashboard`
- [ ] At least one read-heavy page (e.g. Students list, Programmes list) shows real data
- [ ] At least one write path (e.g. update an applicant note) succeeds without error

If any check fails, do not share the URL until resolved.
