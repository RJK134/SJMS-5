# SJMS 2.5 — Vercel + Neon "data is not loading" fix guide

> **Use this when:** the Vercel-hosted SJMS site loads, but every page that
> should show students / programmes / modules / applications is empty.
>
> **Companion:** `docs/VERCEL-RUNBOOK.md` (full runbook). This file is the
> focused triage path for the most common failure mode: a deploy that lands
> successfully but shows no data.

---

## TL;DR — five most likely root causes, in order

0. **The Vercel build command does not chain `deploy-init.ts`** — by far
   the most common cause when the API is up and serving traffic but every
   portal page is empty. Vercel deploys the Express server as a
   serverless function; serverless functions have **no startup hook**, so
   `npm start` (which wires in `deploy-init.ts`) is never called.
   Migrations and the seed therefore never run, and the DB stays empty
   even though `/api/health` says `database: connected`. **Symptom:**
   Build Logs show `prisma generate && tsc` and nothing else. **Fix:** the
   repo's `server/vercel.json` ships with the correct
   `npm run build && npx tsx ../scripts/deploy-init.ts` chain — but if
   the Vercel dashboard has a Build Command override, it wins. Delete the
   dashboard override (Settings → Build and Deployment → Build Command),
   or set it to match.
1. **No backend deployed.** The Vercel project that holds `vercel.json` only
   builds the Vite client SPA. The Express API is a **second** Vercel
   project that must be deployed separately. If you skipped that step,
   every `/api/v1/*` call hits Vercel's static-asset router and returns
   404 — pages render but every table is empty.
2. **`VITE_API_URL` is unset or wrong on the client project.** Without it,
   the SPA falls back to relative `/api/*` requests against its own host
   (the client project), which has no API. Set
   `VITE_API_URL=https://<server-project>.vercel.app/api` per environment.
3. **`DEMO_MODE` is not set on the server project.** Until Keycloak is
   provisioned, every authenticated `/api/v1/*` call returns 401 unless
   `DEMO_MODE=true` is exported. The client masks 401s as silent empty
   states, so this looks identical to "no data exists".
4. **`DATABASE_URL` points at the wrong Neon branch (or is unset).** The
   migrations + seed apply against the configured URL, so a fresh Neon
   branch will be empty until `deploy-init.ts` runs.
5. **The seed did not run / failed.** `deploy-init.ts` is intentionally
   non-fatal on seed errors so the server can still boot. If the seed
   step silently aborted, you have tables but zero rows.

---

## 5-minute diagnostic — run this first

```bash
# From any machine with Node 20+:
git clone https://github.com/RJK134/SJMS-2.5.git
cd SJMS-2.5
npm ci

# Replace the four values with your real ones. The script skips checks
# for variables that are not set, so partial probes work too.
DATABASE_URL='postgres://<neon-pooled>?sslmode=require&schema=sjms_app' \
DIRECT_URL='postgres://<neon-unpooled>?sslmode=require&schema=sjms_app' \
API_URL='https://<server-project>.vercel.app' \
CLIENT_URL='https://<client-project>.vercel.app' \
INTERNAL_SERVICE_KEY='<the value set in Vercel server env>' \
npm run diagnose:vercel
```

The script walks the full Vercel → Neon chain and prints a per-step report:

```
1. Database connectivity (Neon Postgres)
  ✓  DATABASE_URL parses                   host=ep-foo.eu-west-2.aws.neon.tech db=sjms
  ✓  DATABASE_URL ?schema=sjms_app         Correct schema pinned.
  ✓  DATABASE_URL points at Neon           Neon hostname detected.
  ✓  Postgres reachable                    SELECT 1 returned.
  ✗  Seed data present                     persons=0 programmes=0 — seed has not run...

2. Migration connection (DIRECT_URL)
  ⚠  DIRECT_URL is set                     Unset — Prisma migrations will use DATABASE_URL...

3. API reachability (Vercel server project)
  ✓  GET /health                           Server process is alive.
  ✗  GET /api/health                       503 — server is up but its DATABASE_URL...
```

If every step says ✓ but data still doesn't show, jump to
[§ Browser-side checks](#browser-side-checks).

---

## Operator checklist — in deploy order

### A. Neon Postgres

- [ ] A Neon project exists for SJMS.
- [ ] The Neon → Vercel integration is installed and linked to **both**
      Vercel projects (client + server). The integration auto-injects
      `DATABASE_URL` per environment.
- [ ] If you opted out of the integration, set `DATABASE_URL` manually on
      the server project. Format:
      `postgres://<user>:<pwd>@<neon-host>/<db>?sslmode=require&schema=sjms_app`
- [ ] Set `DIRECT_URL` (the Neon **unpooled** endpoint) on the server
      project. Same shape, no `pgbouncer=true`. Migrations route through
      this; runtime queries route through `DATABASE_URL`. Without it, the
      first deploy can fail with `prepared statement does not exist`
      errors mid-migration.
- [ ] If you deleted the `_seed_completed_at` marker row to force a re-seed,
      also `TRUNCATE TABLE sjms_app.persons CASCADE` so the row-count guard
      doesn't short-circuit.

### B. Vercel server project (`sjms-2-5-server`)

- [ ] Project exists, root directory = `server`, framework = "Other".
- [ ] Build command = `npm run build` (inherited from `server/vercel.json`).
- [ ] Install command = `npm ci` (run at repo root so workspaces resolve).
- [ ] Environment variables set per environment (Production / Preview):
      `DATABASE_URL`, `DIRECT_URL`, `CORS_ORIGIN`, `INTERNAL_SERVICE_KEY`,
      `WEBHOOK_SECRET`, `JWT_SECRET`, `NODE_ENV=production`,
      and **`DEMO_MODE=true`** (required until Keycloak lands).
- [ ] `CORS_ORIGIN` includes the **client project's** hostname. If you have
      preview deployments with churning subdomains, append each one or
      switch to a stable preview alias.
- [ ] Deployment **Build Logs** (not Runtime Logs — on Vercel the seed
      runs at build time because serverless functions have no startup
      hook) show the deploy-init sequence:

      ```
      [deploy-init] Running at BUILD time on Vercel.
      [deploy-init] DATABASE_URL → postgres://***:***@ep-foo.neon.tech/sjms schema=sjms_app
      [deploy-init] DIRECT_URL   → postgres://***:***@ep-foo-unpooled.neon.tech/sjms ...
      [deploy-init] Running prisma migrate deploy...
      All migrations have been successfully applied.
      [deploy-init] Database not fully seeded (persons=0, programmes=0) — running seed...
      [deploy-init] Post-seed row counts: persons=850, programmes=12, students=420, enrolments=412
      ```

      If the Build Logs only show `prisma generate && tsc` (with no
      `[deploy-init]` lines), the Vercel dashboard's Build Command setting
      is overriding `server/vercel.json`. Fix it via Settings → Build and
      Deployment → Build Command — either match
      `npm run build && npx tsx ../scripts/deploy-init.ts`, or delete the
      dashboard override so the repo's `server/vercel.json` takes effect.

- [ ] `GET https://<server>.vercel.app/health` returns `{"status":"ok"}`.
- [ ] `GET https://<server>.vercel.app/api/health` returns
      `{"status":"ok", "checks":{"database":"connected"}}`.

### C. Vercel client project (`sjms-2-5-client`)

- [ ] Project exists, root directory = `client`, framework = Vite.
- [ ] Build command, output dir = inherited from repo-root `vercel.json`.
- [ ] Environment variables set per environment:
      `VITE_API_URL=https://<server-project>.vercel.app/api` (note the
      trailing `/api` — the client emits absolute requests to this origin
      plus `/v1/...`).
- [ ] `VITE_AUTH_MODE=dev` for the SPA while Keycloak is not provisioned
      (set in Vercel; the `vercel.json` default is also `dev`).
- [ ] `GET https://<client>.vercel.app/` returns 200 and the HTML
      contains `<div id="root">`.

---

## Browser-side checks

Open the deployed client URL, then DevTools → Network. Try a portal route
that should show data (e.g. `/#/admin/students`). For the first XHR that
hits `/api/v1/students` or similar:

| Symptom | Root cause |
|---|---|
| Request URL is relative (`/api/v1/students` on the **client** host) | `VITE_API_URL` is unset on the client project. The SPA is using the fallback `/api` and hitting the static-asset router. |
| 404 on the API call | Either the server project is not deployed, or `VITE_API_URL` does not include `/api`. |
| 401 / 403 on every API call | `DEMO_MODE` is not set on the server project, and Keycloak is not configured. Set `DEMO_MODE=true` on the server's Vercel env and redeploy. |
| CORS error in the console ("blocked by CORS policy") | `CORS_ORIGIN` on the server does not include the client's hostname. Add it (comma-separated). |
| 200 with `{ data: [] }` | Server is reachable and auth works, but the database is empty. Check the server's **Build Logs** (not Runtime Logs) for the `Post-seed row counts:` line. If it says zeros, redeploy with `FORCE_SEED=true` after deleting `_seed_completed_at`. If the Build Logs show no `[deploy-init]` lines at all, the dashboard Build Command is overriding `server/vercel.json` — see §B. |
| 502 / 504 on the API | The server function is crashing on cold start. Check Runtime Logs for the stack trace — most often a missing required env var (`WEBHOOK_SECRET`, `INTERNAL_SERVICE_KEY` < 32 chars). |

---

## Manual operator fixes

### Force a re-seed without redeploying

```sql
-- In Neon's SQL editor (or psql with DATABASE_URL):
DELETE FROM sjms_app.system_settings WHERE setting_key = '_seed_completed_at';
TRUNCATE TABLE sjms_app.persons CASCADE;
-- The cascade flushes students, enrolments, applications, etc.
```

Then trigger a redeploy from Vercel (Deployments → Redeploy). The
`deploy-init.ts` row-count guard sees zero persons and runs the seed.

Alternatively, set `FORCE_SEED=true` on the server's Vercel env and
redeploy — this bypasses the guard without truncating.

### Run the seed locally against Neon

```bash
DATABASE_URL='postgres://<neon-pooled>?sslmode=require&schema=sjms_app' \
  npm run db:seed
```

Use the **pooled** endpoint for the seed (PGBouncer is fine for the many
short transactions the seed issues). Use the **unpooled** endpoint
(`DIRECT_URL`) if you also need to apply migrations:

```bash
DATABASE_URL='postgres://<neon-unpooled>?sslmode=require&schema=sjms_app' \
  npm run prisma:deploy
```

### Verify what's in the database without leaving the terminal

```bash
DATABASE_URL='postgres://<neon-pooled>?sslmode=require&schema=sjms_app' \
  tsx scripts/diagnostics.ts
```

This prints row counts and sample rows. Read-only — safe on production.

### Bypass auth temporarily to confirm the API works

If `DEMO_MODE` setting via Vercel is too slow, you can hit the API directly
with the internal service key (skip Keycloak entirely):

```bash
curl -sS \
  -H "X-Internal-Service-Key: $INTERNAL_SERVICE_KEY" \
  "https://<server-project>.vercel.app/api/v1/students?limit=5" | jq '.data | length'
```

A non-zero result confirms: server is up, DB is reachable, the seed ran,
and only the browser-facing auth surface is broken.

---

## When to escalate

- Two redeploys with `FORCE_SEED=true` both finish without populating
  `persons` → the seed itself is hitting an error in Vercel's build
  environment. Pull the seed output from **Build Logs** and open an issue.
- `/api/health` returns 503 with `checks.database = "unavailable"` even
  after correcting `DATABASE_URL` → the Neon branch is paused (free tier
  auto-suspend) or the connection is being firewalled. Resume the branch
  in the Neon console.
- Migration logs show `relation "sjms_app.x" already exists` → an older
  deploy partially applied. Restore the Neon branch from a point-in-time
  before the bad deploy (Neon → Branches → New from timestamp), then
  redeploy.

---

## References

- `docs/VERCEL-RUNBOOK.md` — full provisioning and operations runbook
- `scripts/deploy-init.ts` — the migrate + seed orchestration. Runs at
  BUILD time on Vercel (chained via `server/vercel.json` buildCommand);
  runs at runtime in Docker / long-running deployments (chained via
  `server/package.json` start script).
- `scripts/diagnose-vercel-neon.ts` — `npm run diagnose:vercel`
- `scripts/diagnostics.ts` — read-only DB row-count snapshot
- `prisma/schema.prisma` — `url` / `directUrl` split is the Neon canonical
  pattern (see §4.2 in the runbook)
