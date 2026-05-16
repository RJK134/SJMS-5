# SJMS-5 — Build Queue

> **Current Phase:** **Phase 0 — Spine Import**, approved 2026-05-16 and ready to execute.
>
> **Active branches:** `claude/review-sjms-build-eNdyI` (this branch; planning artefacts only). Phase 0 implementation will branch as `phase-0/spine-import`.
>
> **Base:** `main` (one commit — initial README; planning docs on `claude/review-sjms-build-eNdyI`).
>
> **Operating model:** [`docs/SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md).
>
> **Source plan:** [`docs/SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md).
>
> **Inherited governance:** SJMS-2.5 enterprise-delivery operating model (effective 2026-04-22), STOP-gate rule for architecturally significant changes, BugBot loop, PR-per-branch discipline.

---

## Phase ledger

| Phase | Title | HERM | Branch | Status | STOP-gate |
|---|---|---|---|---|---|
| 0 | Spine import + convergence baseline | — | `phase-0/spine-import` | **APPROVED — READY TO EXECUTE** | ✅ Option B signed off 2026-05-16 |
| 1 | Finance closeout (absorb 2.5 18D–F) | L3 | `phase-1/finance-closeout` | not started | none |
| 2 | Multi-tenancy substrate | L8, L10 | `phase-2/multi-tenancy-substrate` | not started | **design doc** (acknowledged) |
| 3 | HESA / UKVI / regulatory utilities | L4 | `phase-3/hesa-ukvi-regulatory` | not started | none |
| 4 | PGR domain | L2.9 | `phase-4/pgr-domain` | not started | none |
| 5 | Apprenticeships domain + Employer portal | L2.10 | `phase-5/apprenticeships-domain` | not started | new portal review |
| 6 | Recruitment / Enquiry CRM | L2.1 | `phase-6/recruitment-crm` | not started | none |
| 7 | Accommodation, Moodle/VLE, AI assistive | L2.5, L7 | `phase-7/accommodation-vle-ai` | not started | AI assistive use cases scoped |
| 8 | n8n activation + UCAS/SLC/UKVI connectors | L7 | `phase-8/integration-activation` | not started | UCAS/SLC commercial agreements |
| 9 | Portal completion, teaching scoping, uploads, WCAG | L2, L5 | `phase-9/portal-completion` | not started | none |
| 10 | Analytics, BI, dashboards, telemetry | L6 | `phase-10/analytics-bi` | not started | none |
| 11 | AI-native operating layer | cross-cutting | `phase-11/ai-native-uplift` | not started | **design doc + ethics review** (acknowledged) |
| 12 | Pilot readiness + SAML federation | L11, L12 | `phase-12/pilot-readiness` | not started | external pentest + ethics sign-off |

---

## Phase 0 — Spine import and convergence baseline (APPROVED)

**Branch:** `phase-0/spine-import` · **HERM:** — · **STOP-gate:** ✅ Option B approved 2026-05-16.

**Canonical batches:**

- **0A.** Clone SJMS-2.5 `main` (post-Phase 18A merge) into SJMS-5. Rebrand: package names, README, CLAUDE.md header, docs:check expected counts, repo URL references, Vercel project name. Acceptance: full Vitest suite green; tsc clean both workspaces.
- **0B.** Import SJMS-2.5 `claude/phase-18b-invoice-generation` and `claude/phase-18c-payment-allocation` as Phase 0 sub-commits. Acceptance: invoice + payment-allocation tests green (~504 tests).
- **0C.** Import v4-integrated's MinIO wiring (`server/src/utils/minio-storage.ts` + multer wired) and AES-256-GCM field encryption (`server/src/middleware/encryption.ts`), adapted to 2.5's middleware shape. Acceptance: presigned upload of a test file succeeds; encrypted field round-trips on a test model.
- **0D.** Import v4-integrated's BullMQ + Redis worker pattern. Acceptance: a no-op BullMQ job round-trips end-to-end; Prometheus exposes queue depth. **Note:** BullMQ worker deploys to a long-running host (Railway/Render/Fly), not Vercel.
- **0E.** Import v4-integrated's k6 scenarios. Acceptance: nightly CI job emits a result on a non-prod target.
- **0F.** Remove the static-secret JWT fallback from `auth.ts` production code path (closes 2.5 Phase 15B primary STOP-gate). Acceptance: env audit shows zero fallback uses; JWT verification fails closed on Keycloak unavailable.
- **0G.** Configure Keycloak realm: enforce OTP MFA on staff/admin and applicant-with-PII roles; configure `smtpServer` block; require email verification. Acceptance: an unenrolled staff user is prompted for OTP setup at first login.
- **0H.** Correct the n8n header name from `x-internal-key` to `x-internal-service-key` in every imported template. Acceptance: a test n8n callback to the API succeeds without a 401.
- **0I.** Initial CI green: typecheck, Prisma validate, unit tests, advisory lint, CodeQL `security-extended`, npm audit, k6 advisory. docs:check passes against the new HERM-tagged counts.
- **0J.** Phase 0 closeout: open KI register, BugBot review on the PR, HIGH findings remediated, evidence pack committed to `evidence/phase-0/`.

**Acceptance criteria for Phase 0:**

- `npm run docs:check` green.
- Full Vitest suite green (target ≥ 504 tests).
- `tsc --noEmit` clean both workspaces.
- `prisma validate` clean.
- CI green (typecheck, prisma, tests, advisory lint, CodeQL, npm audit).
- BullMQ + Redis + MinIO + Keycloak + n8n + Postgres + Nginx all start via `docker compose up -d`.
- Health endpoint returns 200 with DB connectivity.
- Prometheus `/metrics` returns request-duration histogram + total counter.
- Swagger UI at `/api/docs` renders generated OpenAPI spec.
- No static-secret JWT fallback in production code path.
- OTP MFA enforced on Keycloak `fhe` realm staff/admin roles.
- n8n header-name corrected across all 62 imported workflow templates.
- BugBot review on the PR returns no HIGH findings.
- `evidence/phase-0/` contains the import manifest, the verification protocol output, and the BugBot review summary.

---

## Phase 1 — Finance closeout

**Branch:** `phase-1/finance-closeout` · **HERM:** L3 · **No STOP-gate.**

**Canonical batches:**

- **1A.** Payment plans (PaymentPlan + PaymentInstalment service + cron generator). Closes 2.5 Phase 18D.
- **1B.** Sponsors and sponsor agreements. Models: `Sponsor`, `SponsorAgreement`, `SponsorInvoice`. FINANCE-gated.
- **1C.** Bursaries: `BursaryFund`, `BursaryApplication`. Auto-decisions by fund rule; manual override audited.
- **1D.** Refund approvals: `RefundApproval` two-step workflow (REGISTRY proposes → FINANCE approves). Closes 2.5 KI-P10b-001.
- **1E.** Finance auditability uplift: ledger anomaly detection job on BullMQ (negative balance, orphan ChargeLine, duplicate invoice number); Prometheus counter + alert rule.
- **1F.** Finance dashboards in staff portal (collection, ageing, sponsor liability, bursary spend).
- **1G.** Phase closeout: BugBot, coverage ratchet +3pp, evidence pack.

**Acceptance:** every finance sub-domain in [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) §4.2 row 6 is wired with CRUD, audit, webhook, OpenAPI, unit tests. Coverage statement ≥ 38, lines ≥ 38, branches ≥ 36, functions ≥ 19.

---

## Phase 2 — Multi-tenancy substrate (STOP-GATE)

**Branch:** `phase-2/multi-tenancy-substrate` · **HERM:** L8, L10 · **STOP-gate:** design doc approved by Richard before any code lands (precondition acknowledged 2026-05-16).

**Design-doc requirements (pre-implementation):**

- Tenant model definition + relationship map.
- Schema mutation list (which models get `tenantId`, which are global).
- Migration plan (single ALTER per model batch, rollback strategy).
- Repository-layer enforcement contract (default scoped, explicit `withSystemTenant()` opt-out).
- OIDC claim mapping (Keycloak group → tenantId).
- Cross-tenant test plan.
- Performance impact assessment (indexes on `tenantId`).
- Rollout plan (single tenant `fhe` first; second tenant in staging before merging).

**Canonical batches:** to be drafted once the design doc is approved.

---

## Phases 3 – 12

See [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) §5 for full scope. Detailed canonical batches are deferred until the immediately prior phase closes — the SJMS-2.5 pattern of "plan the next phase only when the current one is in flight" produces tighter, more honest plans than a 12-phase upfront breakdown.

---

## Sequenced deferred items (carried over from SJMS-2.5)

| Item | Origin | Target SJMS-5 phase |
|---|---|---|
| MFA enforcement in Keycloak | SJMS-2.5 Phase 15B | Phase 0 (closed at import) |
| Static-secret JWT fallback removal | SJMS-2.5 Phase 15B | Phase 0 (closed at import) |
| KI-P10b-001 finance sub-domains | SJMS-2.5 Phase 18E | Phase 1 |
| KI-P10b-002 MinIO presigned uploads | SJMS-2.5 Phase 21 | Phase 0 wires, Phase 9 hardens |
| KI-P10b-003 teaching-assignment scoping | SJMS-2.5 Phase 21 | Phase 9 |
| KI-P15-001 npm audit baseline triage | SJMS-2.5 | Phase 0 |
| KI-P15-002 ESLint baseline + ratchet to blocking | SJMS-2.5 | Phase 3 (blocking) |
| n8n header-name mismatch | SJMS-2.5 Phase 20 | Phase 0 (closed at import) |
| n8n workflow activation | SJMS-2.5 Phase 20 | Phase 8 |
| Multi-tenancy substrate | SJMS-2.5 post-Phase 23 | **Phase 2** (brought forward — required before functional layering) |
| v4 HesaReturns runtime defect | v4 | Phase 3 |
| v4 finance-overview 404 | v4 | Phase 1 (absorbed) |
| v4 SAML claim unverified | v4 | Phase 12 (implement properly) |
| v4 README schema-size understatement | v4 | Phase 0 (docs:check enforces) |

---

## Completed phases summary

None — Phase 0 approved and ready to execute.
