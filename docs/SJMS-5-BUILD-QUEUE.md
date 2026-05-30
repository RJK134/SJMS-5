# SJMS-5 — Build Queue

> **Current Phase:** **Phase 1 — Finance closeout** (in flight on `main`). Batches 1A, 1B, 1B.1, 1D, 1C have all merged. Remaining: **1E** (ledger anomaly detection) → **1F** (finance dashboards) → **1G** (closeout) → **1H** (optimistic locking, STOP-gate-adjacent) → **1I** (AuditLog FK hardening). After 1I closes, the next non-STOP-gated phase is Phase 3 (HESA / UKVI / regulatory).
>
> **Active branches:** none (last merge was PR #88 — Phase 1C — at commit `8ecfd4c`). Next batch will branch off `main`.
>
> **Base:** `main` (founding plan merged via PR #1).
>
> **Operating model:** [`docs/SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md).
>
> **Source plan:** [`docs/SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) + [`docs/SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](SJMS-5-PLAN-AMENDMENTS-2026-05-16.md).
>
> **Domain leads:** [`docs/skills-leads/`](skills-leads/) — 12 phase-aligned subagent briefs.
>
> **Inherited governance:** SJMS-2.5 enterprise-delivery operating model (effective 2026-04-22), STOP-gate rule for architecturally significant changes, BugBot loop, PR-per-branch discipline.

---

## Phase ledger

| Phase | Title | HERM | Branch | Status | STOP-gate |
|---|---|---|---|---|---|
| 0 | Spine import + convergence baseline (expanded) | — | merged to `main` | **✅ COMPLETE 2026-05-19** — all 14 batches on `main`; see [`SJMS-5-KNOWN-ISSUES.md`](SJMS-5-KNOWN-ISSUES.md) "Phase 0 — COMPLETE" section for the merge ledger | ✅ Option B + Option 1 amendments signed off 2026-05-16 |
| 1 | Finance closeout (absorb 2.5 18D–F + locking + audit FK) | L3 | per-batch sub-branches off `main` (1A–1C, 1D merged) | **in flight** — 5 of 9 batches merged (1A `5089793`, 1B `227ad46`, 1B.1 `b82f141`, 1D `b6ca213`, 1C `8ecfd4c`); remaining 1E / 1F / 1G / 1H / 1I | none (1H soft-gate flagged) |
| 2 | Multi-tenancy substrate | L8, L10 | `phase-2/multi-tenancy-substrate` | not started | **design doc** (acknowledged) |
| 3 | HESA / UKVI / regulatory utilities | L4 | `phase-3/hesa-ukvi-regulatory` | not started | none |
| 4 | PGR domain | L2.9 | `phase-4/pgr-domain` | not started | none |
| 5 | Apprenticeships domain + Employer portal | L2.10 | `phase-5/apprenticeships-domain` | not started | new portal review |
| 6 | Recruitment / Enquiry CRM | L2.1 | `phase-6/recruitment-crm` | not started | none |
| 7 | Accommodation, Moodle/VLE, AI assistive | L2.5, L7 | `phase-7/accommodation-vle-ai` | not started | AI assistive use cases scoped |
| 8 | n8n activation + UCAS/SLC/UKVI connectors | L7 | `phase-8/integration-activation` | not started | UCAS/SLC commercial agreements |
| 9 | Portal completion, teaching scoping, uploads, WCAG, E2E in CI | L2, L5 | `phase-9/portal-completion` | not started | none |
| 10 | Analytics, BI, dashboards, telemetry, OTel, SLOs | L6 | `phase-10/analytics-bi` | not started | none |
| 11 | AI-native operating layer | cross-cutting | `phase-11/ai-native-uplift` | not started | **design doc + ethics review** (acknowledged) |
| 12 | Pilot readiness + SAML + DR + DPIA + cosign | L11, L12 | `phase-12/pilot-readiness` | not started | external pentest + ethics sign-off |

---

## Phase 0 — Spine import and convergence baseline (EXPANDED — APPROVED)

**Branch:** `phase-0/spine-import` · **HERM:** — · **STOP-gate:** ✅ Option B + Option 1 amendments approved 2026-05-16.

**Domain lead:** [`docs/skills-leads/01-phase-0-spine-import.md`](skills-leads/01-phase-0-spine-import.md).

**Canonical batches:**

- **0A.** Clone SJMS-2.5 `main` (post-Phase 18A merge, HEAD `72be597` or later) into SJMS-5. Rebrand: package names, README, CLAUDE.md header, docs:check expected counts, repo URL references, Vercel project name. Acceptance: full Vitest suite green; tsc clean both workspaces.
- **0B.** Import SJMS-2.5 `claude/phase-18b-invoice-generation` and `claude/phase-18c-payment-allocation` as Phase 0 sub-commits. Acceptance: invoice + payment-allocation tests green (~504 tests).
- **0C.** Import v4-integrated's MinIO wiring (`server/src/utils/minio-storage.ts` + multer wired) and AES-256-GCM field encryption (`server/src/middleware/encryption.ts`), adapted to 2.5's middleware shape. **Extends encryption scope to `WebhookSubscription.secretKey` and `UserSession.sessionToken`** (closes deep-review P0 #3). Adds `server/src/utils/cryptobox.ts` with seal/open + 100% unit coverage; idempotent backfill script. Acceptance: presigned upload of a test file succeeds; encrypted field round-trips on a test model; both plaintext columns dropped after backfill verified.
- **0D.** Import v4-integrated's BullMQ + Redis worker pattern. Acceptance: a no-op BullMQ job round-trips end-to-end; Prometheus exposes queue depth. **Note:** BullMQ worker deploys to a long-running host (Railway/Render/Fly), not Vercel.
- **0E.** Import v4-integrated's k6 scenarios. Acceptance: nightly CI job emits a result on a non-prod target.
- **0F.** Remove the static-secret JWT fallback from `auth.ts` production code path (closes 2.5 Phase 15B primary STOP-gate **and** deep-review P0 #7). Acceptance: env audit shows zero fallback uses; JWT verification fails closed on Keycloak unavailable.
- **0G.** Configure Keycloak realm: enforce OTP MFA on staff/admin and applicant-with-PII roles; configure `smtpServer` block; require email verification. Acceptance: an unenrolled staff user is prompted for OTP setup at first login. **Closes deep-review prompt H.**
- **0H.** Correct the n8n header name from `x-internal-key` to `x-internal-service-key` in every imported template. Acceptance: a test n8n callback to the API succeeds without a 401.
- **0I.** Initial CI green: typecheck, Prisma validate, unit tests, advisory lint, CodeQL `security-extended`, npm audit, k6 advisory. docs:check passes against the new HERM-tagged counts.
- **0J.** Phase 0 closeout: open KI register, BugBot review on the PR, HIGH findings remediated, evidence pack committed to `evidence/phase-0/`.
- **0K. (NEW) Governance: branch protection + bus-factor reduction.** Closes deep-review P0 #1 + #6 (prompt A). Update `docs/operations/ci-and-branch-protection.md` to mandate: 2 required reviewers (1 code-owner), `enforce_admins = true`, `required_signatures = true`, `linear_history = true`. Add `@SECOND_OWNER` placeholder to `.github/CODEOWNERS` with TODO. Add `LICENSE` file (UNLICENSED / proprietary). Set real GitHub repo description.
- **0L. (NEW) Transactional outbox + worker.** Closes deep-review P0 #4 (prompt D) — **the load-bearing batch.** New `OutboxEvent` Prisma model + migration. Refactor `server/src/utils/webhooks.ts` so `emitEvent` writes the outbox row inside the caller's Prisma transaction (every call site updated to pass `tx`). New worker `server/src/workers/outbox-worker.ts` polling 1s, claiming via `FOR UPDATE SKIP LOCKED`, exponential backoff (1s → 2048s capped), `DEAD` after 12 attempts. New endpoints `GET /api/v1/admin/outbox` + `POST /api/v1/admin/outbox/:id/replay` (SUPER_ADMIN). Prometheus gauge `sjms_outbox_pending_total` + counter `sjms_outbox_dead_total`. Worker deploys to Railway/Render/Fly long-running host. Runbook in `docs/operations/event-delivery-runbook.md`.
- **0M. (NEW) Supply-chain hardening.** Closes deep-review P0 #5 + P1 #10–11 (prompt E). Pin `minio/minio` and `n8nio/n8n` to specific tags (recorded in `docs/operations/ci-and-branch-protection.md`). Add `.github/workflows/sbom.yml` running CycloneDX (`@cyclonedx/cdxgen`) on PR + push to main, attaching SBOM as workflow artefact. Add `.github/workflows/container-scan.yml` running Trivy on built API + client images, failing on HIGH/CRITICAL with documented allow-list at `docs/operations/trivy-allowlist.yaml`. Add Checkov for Docker/nginx/compose IaC scanning.
- **0N. (NEW) Dependabot alerts enforcement + automated PR review bot.** Closes deep-review P0 #2 (prompt B). Add `.github/workflows/security-meta-check.yml` failing if `gh api repos/${{ github.repository }}/dependabot/alerts` returns 403. Document the manual Settings change in `docs/operations/security-observability.md`. **Wire BugBot or CodeRabbit as the automated PR review bot** (v4-integrated parity for "system automated bug fixing management"). If neither is procurable, fall back to a `code-reviewer` subagent invoked on every PR via a GitHub Action.

**Acceptance criteria for Phase 0:**

- `npm run docs:check` green.
- Full Vitest suite green (target ≥ 540 tests after outbox + cryptobox + governance additions).
- `tsc --noEmit` clean both workspaces.
- `prisma validate` clean.
- CI green (typecheck, prisma, tests, advisory lint, CodeQL, npm audit, security-meta-check, container-scan, SBOM).
- BullMQ + Redis + MinIO + Keycloak + n8n + Postgres + Nginx all start via `docker compose up -d`.
- Health endpoint returns 200 with DB connectivity.
- Prometheus `/metrics` returns request-duration histogram + total counter + outbox gauges.
- Swagger UI at `/api/docs` renders generated OpenAPI spec including new admin/outbox endpoints.
- No static-secret JWT fallback in production code path.
- OTP MFA enforced on Keycloak `fhe` realm staff/admin roles.
- n8n header-name corrected across all 62 imported workflow templates.
- `WebhookSubscription.secretKey` + `UserSession.sessionToken` stored as ciphertext only; plaintext columns dropped.
- BugBot (or equivalent) review on the PR returns no HIGH findings.
- `evidence/phase-0/` contains import manifest, verification protocol output, BugBot summary, SBOM, Trivy report, outbox round-trip evidence.
- LICENSE file present; GitHub repo description set; CODEOWNERS includes second-owner TODO.

---

## Phase 1 — Finance closeout (EXPANDED)

**Branch:** `phase-1/finance-closeout` · **HERM:** L3 · **No STOP-gate.**

**Domain lead:** [`docs/skills-leads/02-phase-1-finance-closeout.md`](skills-leads/02-phase-1-finance-closeout.md).

**Canonical batches:**

- **1A.** Payment plans (PaymentPlan + PaymentInstalment service + cron generator). Closes 2.5 Phase 18D.
- **1B.** Sponsors and sponsor agreements. Models: `Sponsor`, `SponsorAgreement`, `SponsorInvoice`. FINANCE-gated.
- **1C.** Bursaries: `BursaryFund`, `BursaryApplication`. Auto-decisions by fund rule; manual override audited.
- **1D.** Refund approvals: `RefundApproval` two-step workflow (REGISTRY proposes → FINANCE approves). Closes 2.5 KI-P10b-001.
- **1E.** Finance auditability uplift: ledger anomaly detection job on BullMQ (negative balance, orphan ChargeLine, duplicate invoice number); Prometheus counter + alert rule.
- **1F.** Finance dashboards in staff portal (collection, ageing, sponsor liability, bursary spend). Fixes v4 `/staff/finance-overview` 404 (KI-S5-102).
- **1G.** Phase closeout: BugBot, coverage ratchet +3pp, evidence pack.
- **1H. (NEW) Optimistic locking for race-prone models.** Closes deep-review P1 #17 (prompt I). Add `version Int @default(1)` to `Mark`, `ModuleResult`, `Invoice`, `Payment`, `ExamBoardDecision`, `AssessmentAttempt`, `Enrolment`. Repository update methods require expected version; new `ConflictError` (→ HTTP 409) on mismatch; bump on success.
- **1I. (NEW) AuditLog FK hardening.** Closes deep-review P1 #18. Promote `AuditLog.userId` from free-text string to FK on `User` with `onDelete: Restrict`. Soft-deleted-user reference table retains the chain.

**Acceptance criteria:** every finance sub-domain in [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) §4.2 row 6 is wired with CRUD, audit, **outbox event**, OpenAPI, unit tests. Optimistic-locking conflict path tested on each of the 7 listed models. Coverage statement ≥ 38, lines ≥ 38, branches ≥ 36, functions ≥ 19.

---

## Phase 2 — Multi-tenancy substrate (STOP-GATE)

**Branch:** `phase-2/multi-tenancy-substrate` · **HERM:** L8, L10 · **STOP-gate:** design doc approved by Richard before any code lands (precondition acknowledged 2026-05-16).

**Domain lead:** [`docs/skills-leads/03-phase-2-multi-tenancy.md`](skills-leads/03-phase-2-multi-tenancy.md).

**Design-doc requirements (pre-implementation):**

- Tenant model definition + relationship map.
- Schema mutation list (which models get `tenantId`, which are global).
- Migration plan (single ALTER per model batch, rollback strategy).
- Repository-layer enforcement contract (default scoped, explicit `withSystemTenant()` opt-out).
- OIDC claim mapping (Keycloak group → tenantId).
- Cross-tenant test plan.
- Performance impact assessment (indexes on `tenantId`).
- Rollout plan (single tenant `fhe` first; second tenant in staging before merging).
- **OutboxEvent.tenantId** propagation strategy (every emitter must set tenantId).

**Canonical batches:** to be drafted once the design doc is approved.

---

## Phase 3 — HESA / UKVI / regulatory utilities (EXPANDED)

**Branch:** `phase-3/hesa-ukvi-regulatory` · **HERM:** L4

**Domain lead:** [`docs/skills-leads/04-phase-3-hesa-ukvi-regulatory.md`](skills-leads/04-phase-3-hesa-ukvi-regulatory.md). Pulls `skills/hesa-data-management/` + `skills/sjms-compliance-expert/` as primary briefing.

**Canonical batches:**

- **3A.** Import v4's `husid-generator.ts`, `hesa-xml-generator.ts`, `heses-calculator.ts`, `classification-calculator.ts`. Wire into 2.5's `hesa/` flat router.
- **3B.** HESA Data Futures mapping layer end-to-end. `HesaFieldMapping`, `HesaValidationRule`, `HesaCodeTable` models from SJMS-2.5 imported (already present in 197-model base).
- **3C.** UKVI: harden the live UKVI compliance page from SJMS-2.5. UKVI/CAS connector to ECTAS-style export.
- **3D.** EC claims and Appeals downstream actions (was 2.5 Phase 19D). Fire outbox events on every state change.
- **3E.** OfS / TEF regulatory module from v4 scaffolding, adapted to 2.5 patterns.
- **3F. (NEW) HESA snapshot immutability + notification table.** Import SJMS-2.5 patterns from migrations `20260408155000_hesa_snapshot_immutability` and `20260413210029_add_hesa_notification`. PostgreSQL trigger blocking UPDATE/DELETE on `hesa_snapshots`; `HesaNotification` table with status enum.
- **3G.** Fix the v4 `HesaReturns` defect (KI-S5-101). Defensive null-handling + Zod-validated render contract on every numeric field.
- **3H.** ESLint baseline triage + ratchet to blocking (closes deep-review prompt F, KI-S5-005). Drop `continue-on-error: true` from CI Lint job.
- **3I.** Phase closeout: BugBot, evidence pack, coverage ratchet.

**Acceptance:** HESA XML round-trips a real population fixture; HESES calculator matches sector reference dataset; UKVI sponsored-student attestation drives outbox events; EC and Appeals state changes fire outbox events; lint blocking on `main`.

---

## Phase 9 — Portal completion (EXPANDED)

**Branch:** `phase-9/portal-completion` · **HERM:** L2, L5

**Domain lead:** [`docs/skills-leads/10-phase-9-portal-completion.md`](skills-leads/10-phase-9-portal-completion.md).

**Canonical batches:**

- **9A.** Teaching-assignment scoping (closes 2.5 KI-P10b-003 / KI-S5-003).
- **9B.** MinIO presigned uploads (closes 2.5 KI-P10b-002 / KI-S5-002). Virus scan stub (Phase 12 hardens with real scanner). Lifecycle policy.
- **9C.** Replace high-value `ComingSoon` pages. Bundle splitting at route boundaries (closes deep-review P3 #31 — Phase 9 bundle sub-batch).
- **9D.** Applicant / student / staff notification surface improvements.
- **9E.** WCAG 2.2 AA remediation (ratchet from 2.1 → 2.2 per deep-review P2 #26) + axe/pa11y a11y-gate in CI + evidence pack.
- **9F. (NEW) Playwright golden-journey E2E in CI.** Closes deep-review P2 #23 (prompt J). Dockerised stack runner with postgres:16-alpine + redis:7-alpine. Server in `AUTH_BYPASS=true SJMS_ALLOW_DEV_AUTH=1 NODE_ENV=development` test mode. Covers admissions → enrolment, enrolment → marks → progression. Job cap 15 min. Report uploaded on failure.

**Acceptance:** zero high-value `ComingSoon`; WCAG 2.2 AA gate enforced; presigned 10 MB upload succeeds end-to-end; Playwright golden journeys green in CI.

---

## Phase 10 — Analytics, BI, dashboards, telemetry (EXPANDED)

**Branch:** `phase-10/analytics-bi` · **HERM:** L6

**Domain lead:** [`docs/skills-leads/11-phase-10-analytics-bi.md`](skills-leads/11-phase-10-analytics-bi.md).

**Canonical batches:**

- **10A–10E.** As per synthesis plan §5 Phase 10.
- **10F. (NEW) Observability completeness.** Closes deep-review P2 #21 + #22. OTel tracing on server + client, exported to Tempo/Jaeger, correlated with existing request-id middleware. SLO definitions in `docs/operations/slos.yaml`. Prometheus alert rules as code in `docker/prometheus/alerts/`. Runbook entries per alert in `docs/operations/runbooks/`.

---

## Phase 12 — Pilot readiness (EXPANDED)

**Branch:** `phase-12/pilot-readiness` · **HERM:** L11, L12

**Domain lead:** [`docs/skills-leads/13-phase-12-pilot-readiness.md`](skills-leads/13-phase-12-pilot-readiness.md). Primary briefing: `skills/sjms-data-migration-lead/` + `skills/student-finance/12-pci-payment-security-lead.md`.

**Canonical batches (expanded):**

- **12A.** Backup/restore automation (pg_dump + MinIO snapshot + n8n export). DR runbook with RTO/RPO numbers; restore drill captured (closes deep-review P2 #27).
- **12B.** Environment promotion (dev → staging → prod) with `git`-driven config.
- **12C.** Migration rehearsal from a source SIS extract (CSV/XML) — Tribal SITS shape or Banner shape.
- **12D.** External security review (independent pentest) and dependency review.
- **12E.** Support playbooks, runbooks tied to every Prometheus alert.
- **12F.** Training artefacts: short videos per role.
- **12G.** SAML federation (operator-approved deferral).
- **12H. (NEW) MinIO presigned hardening.** Real virus scanner (ClamAV or similar). Lifecycle policies. (Phase 9 ships the basic flow; Phase 12 hardens for pilot.) Closes deep-review P2 #24.
- **12I. (NEW) DPIA / ROPA / subject-rights workflow.** Privacy posture pack (closes deep-review P2 #28).
- **12J. (NEW) SPDX license-policy gate** in CI (allow-list of SPDX IDs). Closes deep-review P2 #29.
- **12K. (NEW) cosign image signing** in deploy pipeline (closes deep-review P2 #30). SLSA provenance.
- **12L.** Pilot gate sign-off pack: HERM matrix, compliance evidence, pentest, k6 at 2× peak.

**Acceptance:** Pilot gate met. Score: HERM ≥ 8.0, security ≥ 9, observability ≥ 9, multi-tenancy ≥ 9.

---

## Phases 4 – 8, 11 (unchanged from synthesis plan §5)

Detailed canonical batches drafted at phase-opening time per the operating model. Domain leads in `docs/skills-leads/` provide the subagent briefing for each.

---

## Sequenced deferred items — updated

| Item | Origin | Target SJMS-5 phase |
|---|---|---|
| MFA enforcement in Keycloak | SJMS-2.5 Phase 15B (P1 #8) | Phase 0 (closed at import via batch 0G) |
| Static-secret JWT fallback removal | SJMS-2.5 Phase 15B (P0 #7) | Phase 0 (closed at import via batch 0F) |
| Encrypt secrets at rest (WebhookSubscription, UserSession) | Deep review P0 #3 (prompt C) | Phase 0 batch 0C extended |
| KI-P10b-001 finance sub-domains | SJMS-2.5 Phase 18E | Phase 1 (1B/1C/1D) |
| KI-P10b-002 MinIO presigned uploads | SJMS-2.5 Phase 21 | Phase 0 wires (0C); Phase 9 ships (9B); Phase 12 hardens (12H) |
| KI-P10b-003 teaching-assignment scoping | SJMS-2.5 Phase 21 | Phase 9 (9A) |
| KI-P15-001 npm audit baseline triage | SJMS-2.5 | Phase 0 (0I) |
| KI-P15-002 ESLint baseline + ratchet to blocking | SJMS-2.5 | Phase 3 (3H) |
| n8n header-name mismatch | SJMS-2.5 Phase 20 | Phase 0 (closed at import via 0H) |
| n8n workflow activation | SJMS-2.5 Phase 20 | Phase 8 |
| Multi-tenancy substrate | SJMS-2.5 post-Phase 23 | **Phase 2** (brought forward) |
| **Transactional outbox for events** | Deep review P0 #4 (prompt D) | **Phase 0 (0L) — load-bearing** |
| **Branch protection + bus-factor reduction** | Deep review P0 #1 + #6 (prompt A) | Phase 0 (0K) |
| **Pin :latest, SBOM, Trivy, Checkov** | Deep review P0 #5 + P1 #10–11 (prompt E) | Phase 0 (0M) |
| **Dependabot alerts enforcement + BugBot** | Deep review P0 #2 (prompt B) | Phase 0 (0N) |
| **Optimistic locking on race-prone models** | Deep review P1 #17 (prompt I) | Phase 1 (1H) |
| **AuditLog FK to User** | Deep review P1 #18 | Phase 1 (1I) |
| **HESA snapshot immutability + notification** | SJMS-2.5 migrations | Phase 3 (3F) |
| **v4 HesaReturns runtime defect** | v4 live build | Phase 3 (3G) |
| **v4 finance-overview 404** | v4 live build | Phase 1 (1F) |
| **v4 SAML claim unverified** | v4 README vs code | Phase 12 (12G) |
| **v4 README schema-size understatement** | v4 README | Phase 0 (docs:check enforces) |
| **Playwright E2E in CI** | Deep review P2 #23 (prompt J) | Phase 9 (9F) |
| **OpenTelemetry tracing + SLOs** | Deep review P2 #21 + #22 | Phase 10 (10F) |
| **WCAG 2.2 a11y CI gate** | Deep review P2 #26 (ratchet from 2.1) | Phase 9 (9E) |
| **Backup/restore + DR drill** | Deep review P2 #27 | Phase 12 (12A) |
| **DPIA / ROPA / DSR workflow** | Deep review P2 #28 | Phase 12 (12I) |
| **SPDX license-policy gate** | Deep review P2 #29 | Phase 12 (12J) |
| **cosign image signing** | Deep review P2 #30 | Phase 12 (12K) |
| **Bundle splitting** | Deep review P3 #31 | Phase 9 (9C) |
| **cursor-agent-manual.yml cleanup** | Deep review P3 #32 | Phase 0 (0I, drive-by) |
| **Align Zod versions across monorepo** | Deep review P3 #33 | Phase 0 (0A, drive-by) |
| **FK onDelete defaults sweep** | Deep review P3 #34 | Phase 2 (alongside tenantId rollout) |
| **Per-purpose Redis namespacing** | Deep review P3 #35 | Phase 10 (alongside observability) |

---

## Completed phases summary

None — Phase 0 approved with expanded scope; awaiting amendments PR merge before `phase-0/spine-import` branch opens.
