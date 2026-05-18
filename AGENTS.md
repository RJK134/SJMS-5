# AGENTS.md

## Cursor Cloud specific instructions

### Environment overview

SJMS 2.5 is a monorepo with `client/` (React/Vite) and `server/` (Express/TypeScript) npm workspaces, backed by PostgreSQL, Redis, and MinIO via Docker Compose. See `README.md` and `CONTRIBUTING.md` for full setup docs and command reference.

### Gotchas

- **dotenv and npm workspaces**: `npm run dev:server` runs `tsx watch src/index.ts` with cwd set to the `server/` package, but the `.env` file normally lives at the repository root. The `dotenv/config` import in `server/src/index.ts` looks for `.env` in cwd and will not find a root-only file. From the repository root, run: `ln -sf "$(git rev-parse --show-toplevel)/.env" server/.env` (or `cd server` and `ln -sf ../.env .env`). Without this, the server starts but auth bypass and database config are missing.

- **Dev auth bypass**: For local development without Keycloak, ensure these three variables are set in `.env`: `AUTH_BYPASS=true`, `NODE_ENV=development`, `SJMS_ALLOW_DEV_AUTH=1`. For the client, it is recommended to set `VITE_AUTH_MODE=dev` explicitly, although the auth resolver defaults to `dev` when it is unset. The `.env.example` already has `VITE_AUTH_MODE=dev` and `NODE_ENV=development`, but `AUTH_BYPASS` and `SJMS_ALLOW_DEV_AUTH` must be appended manually.

- **INTERNAL_SERVICE_KEY**: Must be set to a real random value (not the placeholder). Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Docker Compose will fail to start `n8n` and `api` services without it.

- **Prisma advisory lock timeout**: If you kill a `prisma migrate dev` process mid-run, a session can keep the Prisma migration advisory lock. **Preferred (dev only):** `docker compose restart postgres` (this does **not** wipe database state because Postgres data persists in the Docker volume, but it **will** drop active connections and abort uncommitted/in-flight transactions; use when no other important open sessions). **Targeted:** list backends holding an advisory lock on `sjms`, then terminate only those PIDs. **Avoid** terminating every connection to the database — that is disruptive to other services and sessions.

- **Schema drift vs deploy**: To apply **already committed** migration files to the database (CI, new clone, `migrate deploy` workflow), use `npx prisma migrate deploy --schema=prisma/schema.prisma`. If `prisma migrate dev` reports schema drift and asks for a migration name, generate a new migration with a chosen name, e.g. `npx prisma migrate dev --schema=prisma/schema.prisma --name your_change` (or the non-interactive name your team uses, such as `dev_sync`, when capturing drift in development).

### DEMO_MODE — public preview without Keycloak

**Purpose.** The Vercel-hosted server preview is deployed without a Keycloak service. Without an authentication issuer, every `/api/v1/*` request returns `401 Unauthorized` and the [`futureed.online`](http://futureed.online) demo dashboard cannot load any data. `DEMO_MODE=true` is an **operator-controlled demo-only** shortcut: it short-circuits the JWT verification pipeline in `server/src/middleware/auth.ts::authenticateJWT` and attaches a synthetic admin user (`sub: 'demo-admin'`, `email: 'demo@futureed.online'`, every realm role including `public`) to `req.user`. The synthetic admin passes `requireRole` via the `super_admin` short-circuit and bypasses `data-scope.ts` scoping via the admin/teaching/support short-circuit, so every read endpoint behaves as if a privileged operator hit it.

**Usage.**
- Set `DEMO_MODE=true` in the Vercel server project's Environment Variables (Settings → Environment Variables, scoped to Production / Preview / Development as appropriate).
- The server logs `[DEMO_MODE] Authentication bypass enabled - DO NOT USE IN PRODUCTION WITH REAL DATA` once at boot so the unsafe state is visible in the Vercel Runtime Logs / Function Logs.
- The flag is **off by default**: any value other than the literal string `'true'` (including unset) keeps the full Keycloak verification path active.

**⚠️ Warning.** DEMO_MODE disables authentication entirely for the duration the env var is set. Never enable it on a Vercel environment that points at a database holding real student / staff / financial data. The synthetic admin is granted every role specifically so a stakeholder demo behaves like a fully privileged operator session.

### Trust proxy — Vercel X-Forwarded-For

`server/src/index.ts` calls `app.set('trust proxy', 1)` before the rate-limit middleware so Vercel's reverse-proxy headers are honoured. Without this, `express-rate-limit` raises `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` on every request and the deploy logs spam validation errors. `1` means "trust the first proxy hop" — Vercel's edge topology. Adjust to `2` only if SJMS is ever fronted by a second proxy (e.g. Cloudflare in front of Vercel).

**The setting is gated** so it does NOT apply to direct (non-proxied) deployments where trusting `X-Forwarded-For` would let a client spoof its own `req.ip` and bypass IP-based rate limiting:

- `NODE_ENV=production` → enabled (Vercel sets this automatically on Production)
- `TRUST_PROXY=true` → enabled (explicit opt-in for any other proxied env)
- otherwise → disabled (dev / direct-internet deploys see real socket addresses)

### Infrastructure startup

```bash
# Start required infra (Keycloak, n8n, Nginx are optional for dev)
docker compose up -d postgres redis minio

# Verify containers are healthy
docker compose ps
```

### Key commands

Standard commands are documented in `package.json` scripts and `CONTRIBUTING.md` section 5. The most common:

| Task | Command |
|---|---|
| Install deps | `npm ci` |
| Prisma generate | `npm run prisma:generate` |
| Prisma migrate | `npm run prisma:migrate` (or with `--name X` to avoid interactive prompt) |
| Server dev | `npm run dev:server` (port 3001) |
| Client dev | `npm run dev:client` (port 5173) |
| Server tests | `cd server && npm test` |
| Lint | `npm run lint` |
| Server typecheck | `cd server && npx tsc --noEmit` |
| Client typecheck | `cd client && npx tsc --noEmit` |
| Prisma validate | `npx prisma validate --schema=prisma/schema.prisma` |
| Docs truth check | `npm run docs:check` |

### Docker in Cloud Agent VMs

Docker requires special configuration in Cloud Agent VMs (nested container environment):
- Storage driver must be `fuse-overlayfs` (configured in `/etc/docker/daemon.json`)
- iptables must use legacy mode (`update-alternatives --set iptables /usr/sbin/iptables-legacy`)
- The dockerd process must be started manually: `dockerd &>/var/log/dockerd.log &`
