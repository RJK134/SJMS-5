# SJMS 2.5 — Session memory

Short, date-stamped notes that future Claude Code sessions should read at startup. Entries are append-only; oldest at the top.

---

## 2026-05-11

### CLAUDE_CODE_OAUTH_TOKEN vs ANTHROPIC_API_KEY

- The repository's `claude-code-review.yml`, `claude.yml`, and `claude-code-fix.yml` workflows use the official `anthropics/claude-code-action@v1` and expect `secrets.CLAUDE_CODE_OAUTH_TOKEN`, **not** `ANTHROPIC_API_KEY`. The wiring is correct as-is.
- `CLAUDE_CODE_OAUTH_TOKEN` is the Claude Code OAuth token Richard's Claude Pro/Max account issues via `claude setup-token` (CLI). Bills against his subscription, not a per-token API account.
- `ANTHROPIC_API_KEY` is a per-token Anthropic Console key — separate billing model and **not** what these workflows want.
- A `401 Invalid bearer token` failure on `claude-review` therefore means the value of `CLAUDE_CODE_OAUTH_TOKEN` itself is expired/revoked, NOT that the workflow has the wrong secret name. The OAuth tokens have a finite lifetime and need re-issuing periodically.
- Fix: from a local terminal, run `claude setup-token`, copy the new token, and paste it into Settings → Secrets and variables → Actions → `CLAUDE_CODE_OAUTH_TOKEN`.

### Sandbox proxy blocks force-push and branch-delete

- The harness this assistant runs in proxies all `git push --delete` and `git push --force[-with-lease]` calls and returns `HTTP 403 send-pack: unexpected disconnect`.
- The GitHub MCP server exposes `push_files` (writes a NEW commit on top of an existing ref) but NOT a force-update-ref endpoint.
- Operational implication: when the assistant needs to rebase a PR or delete a branch, it cannot do so directly. Workarounds:
  - For rebases: push the resolved file content as a *new* commit on top of the existing branch HEAD via `push_files`. Squash-merge cleans the history.
  - For branch deletions: the operator must run them locally (`git push origin --delete <branch>`) or use the GitHub UI.

### Tailwind v4 dark variant gotcha (PR #204, merged)

- The correct CSS-first variant is `@custom-variant dark (&:where(.dark, .dark *));` — `:where()` keeps zero added specificity AND matches both the `.dark` element and its descendants.
- The form `(&:is(.dark *))` is broken: it only matches descendants (misses the carrier element) AND increases specificity.
- Conflict markers must be resolved before commit. A previous merge of main into `cursor/css-first-tailwind-theme-212c` committed the file with literal `<<<<<<<` markers, broke the Vite build, and CI hammered the PR for several rounds.

### Recent main merges (last 7 days)

| PR | Title | Date |
|---|---|---|
| #204 | chore(tailwind): complete v3 → v4 CSS-first @theme migration | 2026-05-11 |
| #203 | Add Claude Code GitHub Actions (claude.yml + claude-code-review.yml + claude-code-fix.yml) | 2026-05-09 |
| #202 | Cursor cohort module result generation | 2026-05-08 |
| #201 | Marks `moderatedBy` independence guard | 2026-05-08 |
| #200 | Temporary diagnostic endpoint (Cursor) | 2026-05-08 |
| #199 | RJK134-patch-1 | 2026-05-08 |
| #198 | Cursor production environment hardening | 2026-05-08 |
| #196 | Production-readiness review: gate metrics/docs, harden audit + seed, add Railway runbook | 2026-05-05 |
| #195 | feat(server): add DEMO_MODE auth bypass + trust proxy fix | 2026-05-03 |
| #194 | feat(deploy-init): FORCE_SEED env override | 2026-05-03 |
| #193 | feat(server): DEMO_MODE auth bypass (initial) | 2026-05-03 |
| #191 / #192 | scripts/diagnostics.ts + temporary diagnostic API endpoint | 2026-05-02 |

### Current operational state

- `main` runs on Railway (Express server + Postgres) and Vercel (static client). Vercel rewrites `/api/*` to the Railway hostname stored in `vercel.json`.
- Railway has `DEMO_MODE=true` available as a kill-switch for Keycloak — when set, every request is authenticated as a synthetic `demo-admin` with all 36 roles. Required while Keycloak is not yet deployed alongside the server.
- `deploy-init.ts` is the Railway boot script: runs `prisma migrate deploy`, then seeds the DB if it looks unpopulated (requires both `Person` and `Programme` rows to be present before skipping). Writes a `_seed_completed_at` SystemSetting marker for observability. Honours `FORCE_SEED=true` to bypass the skip.
- `trust proxy = 1` is set only when `NODE_ENV === 'production'` OR `TRUST_PROXY === 'true'` (gated so non-proxied envs aren't exposed to `X-Forwarded-For` spoofing).
- The Tailwind v4 CSS-first migration is complete on main as of PR #204; `client/tailwind.config.ts` is deleted, theme tokens live in `client/src/index.css`'s `@theme` block.

### Outstanding operator actions

- Set `DEMO_MODE=true` on the Railway service env (PR #195's purpose) and trigger a redeploy. Verify `[DEMO_MODE] Authentication bypass enabled` appears in `railway logs`.
- Reissue `CLAUDE_CODE_OAUTH_TOKEN` (see above) to unblock the `claude-review` workflow.
- `KI-P10b-001` (Sponsors/Bursaries/Refunds) closed by the Workstream C1 batch back in PR #180; if the issue tracker still shows it open, close it.

### Things NOT yet on main

- Keycloak service in Railway (long-term replacement for `DEMO_MODE`).
- n8n live wiring (15 workflow JSON files exist but `active: false`; activation is Phase 20).
- SMTP/SMS provider for Communications delivery.
- Stripe / payment-method capture in the student portal.
- Tailwind v4 breaking-change class renames (`outline-none → outline-hidden`, `shadow-sm → shadow-xs`, bare-border default colour, bare-ring default). Deferred to a follow-up PR by the v4 migration commit message.

### In-flight at session close (2026-05-11)

- This memory file is on branch `docs/claude-memory-bootstrap` — needs a PR opened against `main` so the bootstrap notes actually land. Trivial — title `docs(claude): bootstrap .claude/memory.md handover notes`, no code change.
- **PR #218** is open with `claude-review` failing with the same `401 Invalid bearer token` — same root cause as documented above (CLAUDE_CODE_OAUTH_TOKEN value expired). Not a code issue on PR #218; will pass once the secret is refreshed.
- The next-stage prompt scaffolding for the new session lives in the bottom half of the previous assistant response (Prompts A–E covering Keycloak, n8n, SMTP, operator UI, branch sweep). If you want them as a durable runbook, copy into `docs/runbooks/next-prompts.md` before starting the next session.

---

## 2026-05-12

### Deployment architecture correction — Vercel + Neon (no Railway)

Richard confirmed today: the live deployment is **Vercel for the frontend AND backend, with Neon as the Postgres provider**. There is **no Railway service**. Earlier notes (and several files in-repo) treated Railway as the active server host — that is incorrect and reflects a prior state.

**Implications for what was written above (2026-05-11):**

- The 2026-05-11 entry that says "`main` runs on Railway (Express server + Postgres) and Vercel (static client)" is **stale**. Correct picture: Vercel hosts both the static client and the API; Neon hosts Postgres.
- `DEMO_MODE=true` is therefore a **Vercel** environment variable (Settings → Environment Variables on the SJMS project), not a Railway one. Redeploy via Vercel after setting; verify `[DEMO_MODE] Authentication bypass enabled` in Vercel's Runtime Logs / Function Logs (not `railway logs`).
- `deploy-init.ts` is the boot script that runs on whatever long-running process Vercel exposes for the server. The `prisma migrate deploy` + seed flow is unchanged — only the host changes. `DATABASE_URL` points at Neon.
- The handover "Outstanding operator actions" item (b) — set DEMO_MODE on Railway — should read **set DEMO_MODE=true on Vercel** for the relevant environment(s), then redeploy.

### Stale Railway references — cleared (PR #220)

The checklist that lived here (vercel.json, preview-smoke header, runbook rename, diagnostics comment, server comment scrub, AGENTS/skills/KNOWN_ISSUES) was implemented on **2026-05-12** in **PR #220** (`chore: retire stale Railway references`). Intentional remaining `railway` strings are limited to this file’s **2026-05-11 historical block** (verbatim), the migration note at the top of `docs/VERCEL-RUNBOOK.md`, and archived `previous-threads/*`.

**Operator reminder:** after **PR #220** follow-up commit `d255efe`, `vercel.json` has **no** `/api/*` rewrite — Vercel cannot interpolate env vars into rewrite destinations, so the client must call the API via an absolute origin. Set **`VITE_API_URL`** to the full server URL in **each** Vercel client environment (Production / Preview / Development); see `docs/VERCEL-RUNBOOK.md` §3.3. Local `npm run dev:client` still works with the Vite proxy when `VITE_API_URL` is unset. Ensure `CORS_ORIGIN` on the server allow-lists every client origin you use (preview aliases churn).

The `.claude/memory.md` 2026-05-11 entry above is **left in place verbatim** as the historical record. This 2026-05-12 entry is the canonical correction; future sessions should treat it as the override.

### Practical effect on the pending operator actions

- (a) Reissue `CLAUDE_CODE_OAUTH_TOKEN` — **already resolved.** Commit `f48c38b` (2026-05-11, between the previous session's close and today) switched the workflows from `CLAUDE_CODE_OAUTH_TOKEN` to API key auth. No token reissue needed.
- (b) Set `DEMO_MODE=true` — **still pending**, but on **Vercel**, not Railway. Set it as a Project Environment Variable for the relevant environment (Production / Preview / Development as appropriate), redeploy, then verify in Vercel's Runtime Logs. PR #218 has merged so the handover's docs-PR item is also resolved.
