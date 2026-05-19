# Operator Action Register

> **Purpose:** Consolidated ledger of every action the operator (Richard Knapp,
> with Freddie joining as second collaborator) needs to take **outside** the
> Claude Code build to progress SJMS-5 toward production.
>
> **Scope:** External actions only — repo settings, third-party platform
> accounts, external secrets, external review engagements. Items inside the
> codebase are tracked in [`docs/SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md)
> and the per-phase build queue.
>
> **Convention:** every row carries an urgency, the originating PR/batch, and
> the unblock effect (what becomes possible after the action lands).

---

## Urgency legend

| Tier | Meaning |
|---|---|
| **A — this week** | Required to merge currently-open PRs without friction |
| **B — before Phase 1 closes** | Required to deploy / run the new Phase 1 surface in any environment |
| **C — Sprint 2 (next 2–4 weeks)** | Required for Phase 1 → Phase 2 transition |
| **D — pilot readiness (Phase 12, months out)** | Required for the FHE University pilot to launch |

---

## Tier A — this week

| # | Action | Where | Origin | Unblocks |
|---|---|---|---|---|
| A1 | **Add Freddie as collaborator on `RJK134/SJMS-5`** | GitHub → Settings → Collaborators | KI-S5-302 (bus-factor); PR #43 0K | Honest 2-reviewer branch protection; the `@SECOND_OWNER` rule cannot be enforced until this happens |
| A2 | **Replace `@SECOND_OWNER` in `.github/CODEOWNERS`** with Freddie's GitHub login | Single sed-or-edit + chore PR (or one Claude session) | KI-S5-302; PR #43 0K | Same as A1 — required for the codified policy to be honest |
| A3 | **Set the GitHub repo description** | Settings → General → Description | KI-S5-306; PR #43 0K | Closes the visible-half of KI-S5-306; satisfies SJMS-5 surface-honesty doc |
| A4 | **Apply codified branch protection** to `main` | `gh api -X PUT /repos/RJK134/SJMS-5/branches/main/protection --input scripts/governance/protection.json` + the separate `POST /repos/RJK134/SJMS-5/branches/main/protection/required_signatures` | PR #43 0K | Locks the policy ratchet — no more force-push, signed commits required, 2 reviewers, no admin bypass |
| A5 | **Enable Dependabot alerts** | Settings → Code security and analysis → Dependabot alerts: ON; Dependabot security updates: ON | PR #72 0N; KI-S5-303 | Turns the green `security-meta-check.yml` workflow live |
| A6 | **Triage open PRs** | github.com/RJK134/SJMS-5/pulls | Multiple agents | Closes the merge backlog (#74, #75, #76, #77, #78, #81) |

**Estimated operator effort for Tier A:** ~1 hour total. All are click-or-paste actions; no software install.

---

## Tier B — before Phase 1 closes

| # | Action | Where | Origin | Unblocks |
|---|---|---|---|---|
| B1 | **Create Railway account + project** in `eu-west2` (London) | https://railway.com → new project | Design note PR #74 §10 decision 1 + 2 | The long-running worker host. Without it, the merged outbox (0L) and BullMQ (0D) workers cannot run; the new payment-instalment cron (1A) cannot fire |
| B2 | **Connect Railway → GitHub auto-deploy** on `main` | Railway → service → settings | Design note §10 decision 8 | Push-to-main → auto-deploy to the worker host |
| B3 | **Provision the Railway Redis add-on** | Railway → project → New → Database → Redis | Design note §10 decision 3 | BullMQ queue backing store |
| B4 | **Set Railway service env vars** | Railway → service → Variables — `DATABASE_URL` (Neon pooled), `DIRECT_URL` (Neon unpooled), `REDIS_URL` (Railway-internal), `WEBHOOK_BASE_URL` (n8n URL), `INTERNAL_SERVICE_KEY` (64-char random), `NODE_ENV=production`, `LOG_LEVEL=info`, `WORKER_METRICS_PORT=3002` | Design note §5.2 | Worker process configuration |
| B5 | **Set `SJMS_ENABLE_PAYMENT_INSTALMENT_CRON=true`** on Railway worker service | Railway → service → Variables | PR #81 batch 1A | The daily 02:30 UTC instalment-cron starts firing |
| B6 | **Set Railway billing alert at £25/month** | Railway → Account → Billing → Alerts | Design note §10 decision 6 | Cost-overrun protection |
| B7 | **Configure a `sjms-5-load-test` confidential client** in the Keycloak `fhe` realm | Keycloak admin console → Clients → Create — `client-secret` authenticator, direct-access-grants enabled | PR #46 0E (k6 nightly job) | Unblocks the k6 nightly load test against staging |
| B8 | **Set `K6_BASE_URL` repo secret** to the staging API URL | GitHub → Settings → Secrets and variables → Actions | PR #46 0E | k6 nightly emits a real result |
| B9 | **Set `K6_KEYCLOAK_CLIENT_SECRET` repo secret** | Same place | PR #46 0E + B7 | k6 can obtain a Keycloak token |
| B10 | **Set the SMTP password in Keycloak admin console** | Keycloak admin console → Realm Settings → Email → Authentication → Password | PR #45 0G | Email-verification gate becomes deliverable; ↩ replaces the `smtp.example.com` placeholder shipped by 0G |
| B11 | **Replace `smtp.example.com` placeholder host** with the institution's real SMTP server | Same as B10 — Host field | PR #45 0G | Required for B10 to work in practice |
| B12 | **Update `scripts/keycloak-setup.ts`** to programmatically enrol TOTP + mark `emailVerified: true` on seeded test users (one Claude session — small scope) | Repo code change | PR #45 0G | Otherwise every E2E test run hits the CONFIGURE_TOTP gate on first login |

**Estimated operator effort for Tier B:** ~3–4 hours. Mostly Railway + Keycloak admin console work.

---

## Tier C — Sprint 2 (next 2–4 weeks)

| # | Action | Where | Origin | Unblocks |
|---|---|---|---|---|
| C1 | **Identify and engage a UK HE-shaped n8n host** | n8n.cloud OR self-host on Railway | KI-S5-009 (workflows not provisioned) | Phase 8 (n8n activation) |
| C2 | **Generate `INTERNAL_SERVICE_KEY` value** (64-char random) and set on Vercel + Railway + n8n credential simultaneously | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` then paste into Vercel, Railway, n8n | Phase 0F + 0G + 0H | End-to-end webhook delivery (API → outbox → worker → n8n → API callback) |
| C3 | **Run `provision-n8n-workflows.ts`** against the deployed n8n instance | `npm run provision:workflows` (operator-driven; requires n8n API key set as `N8N_API_KEY`) | Phase 0H + Phase 8 | All 15 workflow templates land in the live n8n instance |
| C4 | **Smoke-test the end-to-end outbox flow** by triggering a known mutation on the deployed Vercel API and confirming the row appears in `OutboxEvent`, the worker picks it up within ~5 s, n8n receives the webhook with the correct `x-internal-service-key` header, and the row flips to `DELIVERED`. Record in `evidence/phase-0/0l-outbox-smoke.md` | Vercel + Railway + n8n + Postgres console | PR #71 0L | Closes the 0L "end-to-end smoke" acceptance |
| C5 | **Engage a UK HE AI ethics consultancy** for the Phase 11 STOP-gate | Discovery call with UCL Centre for Artificial Intelligence or similar | Phase 11 (AI-native) | Phase 11 can open. Without this, Phase 11 cannot begin (operating-model §6) |
| C6 | **Set up the dataset-import lake credentials** (`RCLONE_CONFIG_GDRIVE5TB_*` secrets) | GitHub → Settings → Secrets and variables → Actions | PR #35 (lake-drift-detector) + PR #76 (D8 weekly scheduler) | Weekly dataset refresh from `gdrive5tb:sjms-5-dataset/` |

**Estimated operator effort for Tier C:** ~6–8 hours over 2–4 weeks. Mostly one-off external-relationship work.

---

## Tier D — pilot readiness (Phase 12, months out)

| # | Action | Where | Origin | Unblocks |
|---|---|---|---|---|
| D1 | **Engage an external pentest provider** | UK CREST-accredited firm (e.g. NCC Group, Bishop Fox, Pen Test Partners) — book ~3 months ahead | Phase 12D | Phase 12 acceptance criterion |
| D2 | **Engage UK HE compliance consultancy for DPIA / ROPA** | UCISA member firm or specialist (e.g. JISC, Mishcon de Reya, RGCC) | Phase 12I; KI-S5-325 | Phase 12 acceptance |
| D3 | **Anthropic API key + monthly budget** for Phase 11 | https://console.anthropic.com → API keys; set repo secret `ANTHROPIC_API_KEY` | Phase 11 | AI-native uplift can begin (subject to D2 ethics review) |
| D4 | **UK Access Federation membership** for SAML federation (Phase 12G) | https://www.ukfederation.org.uk/ — membership application + Shibboleth IdP/SP setup | Phase 12G; KI-S5-103 | SAML federation goes live for the pilot tenant |
| D5 | **`cosign` keypair + transparency log** for image signing (Phase 12K) | Operator generates keypair via `cosign generate-key-pair`; stores key as `COSIGN_PRIVATE_KEY` repo secret; transparency log via Rekor (https://rekor.sigstore.dev/) | Phase 12K; KI-S5-310 | Signed-image provenance for production deploys |
| D6 | **Backup destination** for `pg_dump` + MinIO snapshots | AWS S3 bucket OR Azure Blob in UK region — match HESA / GDPR data-residency requirements | Phase 12A; KI-S5-323 | DR runbook can complete |
| D7 | **Decide pilot deployment topology** (Vercel + Neon serverless, OR on-prem, OR AWS GovCloud, OR institutional Azure) | Architectural decision — likely requires institutional input from FHE University's IT services | Pilot readiness | Real pilot can launch |
| D8 | **SITS / Banner / Workday extract from the source institution** for migration rehearsal | Operator-driven export request from FHE University's source SIS | Phase 12C; KI-S5-202 | One-shot migration validation that production data can be ingested cleanly |

**Estimated operator effort for Tier D:** 100+ hours over 3–9 months. Mostly procurement, vendor selection, and institutional liaison.

---

## Action items already CLOSED on `main`

For completeness — these were on previous operator-action lists but are now done:

| ✅ | What | Closed by |
|---|---|---|
| ✓ | Trigger the Phase 0A bootstrap workflow | Workflow ran successfully; spine landed on `phase-0/spine-import` 2026-05-18 |
| ✓ | Switch the bootstrap workflow's checkout token to `SJMS_V4_TOKEN` | PR #37 merged |
| ✓ | Approve PR #10 (YAML fix) for the bootstrap workflow | Merged 2026-05-17 |
| ✓ | Merge the 8 overnight Phase 0 draft PRs | Replaced by alternative agents shipping 0D/0L/0N/0C/0I via PRs #67–#73; same effect |

---

## How to use this register

1. **Tier A first.** Block other progress; quick wins.
2. **Tier B before deploying Phase 1.** Worker hosting is the binding constraint.
3. **Tier C in parallel with Phase 1 → Phase 2 transition.** External-relationship lead time.
4. **Tier D begins when Phase 11 / Phase 12 are sequenced (months out).** Plan ahead — pentest providers book up.

When an item is done, move it to the "Closed" section above with a one-line closure note and the merge commit / external receipt reference. The convention mirrors the KI register's lifecycle pattern (per [operating-model §8](../SJMS-5-OPERATING-MODEL.md)).

---

## Repository / domain references

- **GitHub repo:** https://github.com/RJK134/SJMS-5
- **Pilot anchor:** FHE University (synthetic-mirror UK HE; comprehensive dataset on operator's Google Drive at `richardknapp134@gmail.com`, rclone remote `gdrive5tb:sjms-5-dataset/`)
- **Operator GitHub handle:** `@RJK134`
- **Second-owner placeholder:** `@SECOND_OWNER` → Freddie's GitHub login (to be set per A1/A2)
- **Operator email contact:** `governance@futurehorizons.education` (per the `LICENSE`)
