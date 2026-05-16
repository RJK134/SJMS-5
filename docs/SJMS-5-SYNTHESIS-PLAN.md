# SJMS-5 — Enterprise Synthesis Plan

> **Status:** founding plan, awaiting operator approval before Phase 0.
> **Author:** Claude (Opus 4.7) acting as senior architect for Richard Knapp.
> **Date raised:** 2026-05-16.
> **Source inputs:** SJMS-2.5 repo state (README, BUILD-QUEUE, KNOWN_ISSUES,
> 62 API directories, `prisma/schema.prisma` 196 models), SJMS v4-integrated
> repo state (README, 42 API modules / 78 routers, 199-model schema, 62 n8n
> templates, 5 portals), and the comparative analysis document
> `SJMS_v4integrated_vs_SJMS_2.5___Comprehensive Comparative Analysis`.

---

## 1. Executive verdict

SJMS-5 should be built by **rebasing SJMS v4-integrated's functional surface
onto SJMS-2.5's architectural spine** — not by cloning v4-integrated and
hardening it, and not by extending SJMS-2.5 module-by-module. SJMS-2.5 is
the **structurally trustworthy** codebase (cleaner domain decomposition,
enterprise auth, structured observability, security gates, honest
documentation, STOP-gated governance), but it is functionally narrow.
SJMS v4-integrated is **functionally rich** (five portals, AI, PGR,
apprenticeships, recruitment CRM, accommodation, HESA artefacts, BullMQ +
MinIO already wired, 62 n8n templates) but **fragile in depth** (live
build pages throw on seeded data, observability is lighter, multi-tenancy
is half-built, SAML claimed but unverified). The right outcome is one
converged system that takes the spine from 2.5 and the surface from v4,
then adds an AI-native operating layer that neither has today.

**Cumulatively, this gets SJMS-5 inside the territory currently held by
Tribal SITS and Ellucian Banner** (HERM capability coverage ≈ 8.0–8.5)
while retaining the agility, AI-native UX, and lower operating cost of a
modern stack.

---

## 2. Current state — verified

### 2.1 SJMS-2.5 (the spine)

| Layer | Verified state | Notes |
|---|---|---|
| Phase 17 (Assessment → Progression → Award) | **COMPLETE** | 17A–17F all merged. Marks aggregation, moderation, exam boards, progression decisioning, classification, transcripts all live. Coverage thresholds ratcheted to `lines:35 / functions:16 / branches:33 / statements:35`. |
| Phase 18A (fee calculation engine) | **MERGED (PR #171)** | `calculateFee` utility + service orchestrator + FINANCE-gated endpoints + webhooks. |
| Phase 18B (invoice and charge generation) | **DONE on `claude/phase-18b-invoice-generation`** (PR #173 draft per handover) | `composeInvoiceFromAssessment` utility + `invoices.service.generateForFeeAssessment` + atomic Invoice + ChargeLine + StudentAccount transaction + 21 + 16 tests. Currently 0 open PRs visible — assumed merged or stacked behind 18C. |
| Phase 18C (payment allocation) | **DONE on `claude/phase-18c-payment-allocation`** (stacked on 18B) | `allocatePayment` (FIFO + PROPORTIONAL), `payments.service.allocateForPayment`, payment ledger entry, 21 + 19 tests. |
| Phase 18D (payment plans + finance auditability) | **NOT STARTED** | |
| Phase 18E (sponsors / bursaries / refunds) | **NOT STARTED** | Closes KI-P10b-001. |
| Phase 18F (closeout) | **NOT STARTED** | |
| Phase 19 (HESA / UKVI / EC / Appeals execution) | **NOT STARTED** | Planned but no v4-style HUSID/HESA-XML/HESES utilities yet. |
| Phase 20 (n8n activation + UCAS/SLC connectors) | **NOT STARTED** | 15 n8n JSONs sit unprovisioned. Known header-name mismatch (`x-internal-key` vs `x-internal-service-key`). |
| Phase 21 (MinIO presigned uploads + portal completion + teaching scoping + WCAG) | **NOT STARTED** | Closes KI-P10b-002 (MinIO) and KI-P10b-003 (teaching assignment). |
| Phase 22 (analytics / BI / dashboards) | **NOT STARTED** | |
| Phase 23 (pilot readiness, backup/restore, migration rehearsal) | **NOT STARTED** | |
| Phase 15B (auth fallback, MFA enforcement, identity cache, retention) | **STOP-GATED** | Awaiting design doc approval. |
| Vercel + Neon serverless deployment fix (PR #223 in handover) | **MERGED** (no open PRs in repo) | Build-time `deploy-init.ts` wiring. Operator action confirmed via current `vercel.json`. |

### 2.2 SJMS v4-integrated (the surface)

| Capability | State | Source artefact |
|---|---|---|
| 5-portal layout (Applicant / Student / Academic / Staff / Enrol Online) | Wired, render against seed | `client/src/pages/{applicant,student,academic,staff,enrolment}/` |
| 42 API modules / ~78 routers / 1,400+ endpoints | Wired | `server/src/api/` |
| 199 Prisma models / 4,755 lines schema | Persisted | `prisma/schema.prisma` |
| BullMQ + Redis async | Wired | `package.json` + `server/src/utils/` |
| MinIO 4-bucket storage (documents, transcripts, evidence, certificates) | **Wired end-to-end** | `server/src/utils/minio-storage.ts` |
| AES-256-GCM field encryption | Wired | `server/src/middleware/encryption.ts` |
| Multi-tenancy middleware + `tenantId` on User | **Partial** — middleware exists, `tenantId` not propagated to all operational entities | `server/src/middleware/multi-tenancy.ts` |
| 62 n8n workflow templates + 2-way PowerShell sync | Templates present, header-name mismatch not corrected | `n8n-workflows/` |
| HESA artefact utilities | Wired | `server/src/utils/{husid-generator,hesa-xml-generator,heses-calculator,classification-calculator}.ts` |
| AI module (chat + embeddings) | Wired | `server/src/api/ai/` |
| PGR domain (supervision, milestones, viva, thesis) | Wired | `server/src/api/pgr/` |
| Apprenticeships (OTJ, EPA, funding, employer portal) | Wired | `server/src/api/apprenticeships/` |
| Recruitment / Enquiry CRM | Wired | `server/src/api/recruitment/` |
| Accommodation lifecycle | Wired | `server/src/api/accommodation/` |
| Moodle/VLE sync | Wired | `server/src/api/moodle/` |
| Regulatory (OfS/TEF) | Wired | `server/src/api/regulatory/` |
| Multi-tenancy domain (`tenants`) | Wired surface | `server/src/api/tenants/` |
| k6 load scenarios (admissions-peak, enrolment-period, HESA return) | Wired | `k6/scenarios/` |
| Observability (Winston / Morgan, audit, request-logger) | Lighter than 2.5 — **no Prometheus, no auto-generated OpenAPI** | |
| Identity (9 documented roles, OIDC + SAML claimed) | OIDC wired; **SAML unverified** | |
| Live build defects | `HesaReturns` throws on seeded payload; `/staff/finance-overview` 404s | Per comparative analysis browser walk |
| README accuracy | Schema size understated by ~⅓; role catalogue shallower than asserted | |

### 2.3 SJMS-5 (target)

Currently empty (`README.md` only on `main`). This branch
(`claude/review-sjms-build-eNdyI`) holds the founding planning artefacts.

---

## 3. Strategic options considered

Three strategies were evaluated. The recommendation is **Option B** — operator-approved 2026-05-16.

### Option A — Extend SJMS-2.5 in place, retire v4-integrated

Rejected. Loses the v4 functional surface (~8–12 phases to recreate). Loses the chance to rebrand.

### Option B — **(APPROVED 2026-05-16)** Clone SJMS-2.5 into SJMS-5, layer v4 surface

Phase 0 imports the SJMS-2.5 spine (code, schema, governance, tests, CI, security gates) into SJMS-5 wholesale. Phase 1 absorbs the in-flight SJMS-2.5 Phase 18 finance work (18B–18F) so SJMS-5 starts from a complete Phase 18. Phases 2–10 layer v4-integrated's missing functional domains onto the spine, in HERM-aligned order, with v4 code **adapted to 2.5's architectural patterns** (flat-router + group barrel, Zod-driven OpenAPI, Winston JSON, repository layer, Prometheus, OIDC-first with the 2.5 realm). v4's HESA utilities, MinIO wiring, BullMQ async, AES-256-GCM encryption, n8n templates, and k6 scenarios are imported as **net-additive assets** with the corrections identified in the comparative analysis (n8n header name, observability uplift, multi-tenancy completion).

### Option C — Greenfield SJMS-5, gradual import

Rejected. Loses the 196-model schema, the seven migrations, the 504-test suite, the CI workflows, the security gates, the realm JSON.

---

## 4. Target architecture

### 4.1 Reference topology

Nginx (CSP + TLS, prod) in front. Client (React 19 + shadcn) and API (Express 5 + `/api/v1` + 44+ routers). Keycloak (realm `fhe`, OIDC + SAML, 35+1 roles, MFA enforced). n8n (62 workflows). MinIO (4 buckets, signed). Postgres with two schemas (`sjms_app` operational + `sjms_reporting` views). BullMQ workers on Redis. Prometheus scrape + Loki/Grafana logs.

**Key topology decisions:**

- **Single Postgres, two schemas.** `sjms_app` (operational) and `sjms_reporting` (read replica or materialised views).
- **Adopt 2.5's dev pattern (infra in Docker, app local) for development** and v4's docker-compose (8 services, ~6.3 GB) for staging/prod.
- **OIDC at Keycloak, SAML added once OIDC parity is verified** (Phase 12).
- **BullMQ on Redis** for in-process async (notifications, bulk imports, HESA XML generation, mark aggregation cohort batches).
- **n8n for orchestrated cross-domain workflows** (UCAS imports, SLC reconciliation, escalations, the 14-stage curriculum approval pipeline) with the header name corrected to `x-internal-service-key` everywhere.
- **MinIO for documents, transcripts, evidence, certificates** with presigned uploads from the client (closes 2.5 KI-P10b-002).
- **Prometheus scrape + Loki/Grafana log aggregation** as standard observability stack.

### 4.2 API surface — group barrels, HERM-tagged

Adopt 2.5's flat-router + group-barrel topology. Group barrels are additive — flat routes are unchanged, but every barrel carries an HERM v3.1 capability tag in its `index.ts` JSDoc and in the OpenAPI spec.

| Group barrel | Modules (alphabetised) | HERM tag |
|---|---|---|
| `student-journey` | `students`, `demographics`, `persons`, `identifiers`, `change-of-circumstances`, `support`, `disability`, `wellbeing-safeguarding`, `gdpr` | L2 |
| `recruitment-admissions` | `recruitment`, `enquiry-management`, `applications`, `admissions`, `admissions-events`, `offers`, `clearance-checks`, `applicant`, `interviews`, `references` | L2.1, L2.2 |
| `curriculum-quality` | `programmes`, `programme-routes`, `programme-modules`, `programme-approvals`, `modules`, `module-registrations`, `curriculum` (14-stage), `committees`, `surveys`, `ilo-mapping-matrix`, `governance` | L2.4, L5 |
| `teaching-delivery` | `teaching-events`, `timetable`, `rooms`, `attendance`, `engagement`, `moodle`, `ai` (assistive only) | L2.5 |
| `assessment-progression` | `assessments`, `submissions`, `marks`, `anonymous-marking`, `second-marking`, `exam-boards`, `module-results`, `progressions`, `awards`, `transcripts`, `graduation-awards` | L2.6, L2.7 |
| `finance` | `fee-assessments`, `invoices`, `payments`, `payment-plans`, `payment-instalments`, `credit-notes`, `sponsors`, `sponsor-agreements`, `bursary-applications`, `bursary-funds`, `refund-approvals`, `debt-management`, integration adapter for `slc` | L3 |
| `compliance-regulatory` | `ukvi`, `hesa-returns` (HUSID, XML, HESES), `regulatory` (OfS/TEF), `data-quality`, `change-audit`, `audit`, `ec-claims`, `appeals` | L4 |
| `pgr-apprenticeship` | `pgr` (supervision/milestones/viva/thesis), `apprenticeships` (OTJ/EPA/funding/employer) | L2.9, L2.10 |
| `services` | `accommodation`, `communications`, `notifications`, `self-service`, `documents`, `bulk-upload`, `webhooks`, `n8n`, `integrations` | L7, L9 |
| `platform` | `health`, `diagnostics`, `metrics`, `audit-trail`, `tenants`, `users`, `identity`, `config`, `system` | L8, L10, L12 |

### 4.3 Data model convergence

Take **v4-integrated's schema as the base** (199 models / 4,755 lines) and merge in the **SJMS-2.5 finance and assessment ledger** entities as net-additive:

- `AnonymousMarkingAllocation`, `SecondMarkingAllocation`, `ExamBoardDecision`, `Transcript`, `TranscriptLine` (from 2.5)
- `FeeAssessment`, `Invoice`, `ChargeLine`, `StudentAccount`, `Payment`, `PaymentPlan`, `PaymentInstalment`, `CreditNote`, `SponsorAgreement`, `BursaryFund`, `BursaryApplication`, `RefundApproval`, `ClearanceCheck` (from 2.5)
- `Award`, `AwardRecord`, `Classification`, `ProgressionRule`, `ClassificationRule` (from 2.5 Phase 17D/E)

**Unify identifiers:** `STU-YYYY-NNNNN` students, `FHE-YYYY-NNNNN` applicants, `HUSID` as separate HESA field, `INV-{shortYear}-{acc8}-{fa8}` invoices.

**Standardise on every operational entity:** `deletedAt`, audit columns, `tenantId` (default `fhe`), `Decimal @db.Decimal(10,2)` for GBP.

**Schema migration strategy:** SJMS-5 starts with a **single consolidated migration `0001_init`**. The seven applied SJMS-2.5 migrations and the v4 migration history are retired. Production data migration happens via Phase 12 (pilot rehearsal), not at schema-init time.

### 4.4 Identity, security, multi-tenancy

- **Keycloak realm:** SJMS-2.5's `fhe` realm JSON as the source of truth (35 + 1 roles). Migrate v4's 9 roles into this realm during Phase 0.
- **Remove the static-secret JWT fallback in production** before Phase 0 closes.
- **Enforce OTP MFA** on staff/admin and applicant-with-PII roles.
- **Add SAML federation in Phase 12**, after OIDC parity is verified.
- **Promote `tenantId` to a first-class column** on every operational entity. Default `tenantId = 'fhe'`.
- **Keep AES-256-GCM field encryption** (v4 middleware) for sensitive PII.
- **Keep CodeQL `security-extended`, npm audit, SECURITY.md, CODEOWNERS, GitHub PVR** (all from 2.5).
- **Add SAST + dependency scanning** in CI weekly.

### 4.5 Observability, testing, gates

- **Take 2.5's observability stack as canonical** — Winston JSON + AsyncLocalStorage request-ID, Prometheus `/metrics`, Swagger UI from Zod schemas.
- **Take v4's k6 scenarios** as a nightly CI job with thresholds.
- **Coverage gates:** start at `lines:35 / functions:16 / branches:33 / statements:35`. Ratchet +3pp per phase closeout, capping at 70/50/50/70 by Phase 10.
- **Lint gate:** advisory through Phase 2, blocking from Phase 3 onward.
- **Loki + Grafana** for log aggregation. Standard dashboards for request rate, error rate, p95 latency, BullMQ queue depth, n8n run rate, finance ledger anomaly detection.

### 4.6 Workflow and integration spine

- **Import v4's 62 n8n templates** with the corrected `x-internal-service-key` header.
- **Add BullMQ + Redis** for in-process async.
- **Wire MinIO end-to-end** with multer + presigned uploads.
- **Stand up the SLC, HESA, Moodle, and UCAS connectors** v4 has scaffolded. Add UKVI/CAS connector.
- **Webhook contract:** every mutation produces an audit-log row and a webhook event. The catalogue is the OpenAPI spec's `events` section.

---

## 5. Phased delivery plan

Twelve phases. Each maps to one feature branch from `main` and produces one merged PR. STOP-gates are explicit. Phase 0 is the only mechanical phase — every subsequent phase is reviewable product work.

### Phase 0 — Spine import and convergence baseline

**Branch:** `phase-0/spine-import` · **STOP-gate:** Option B approved 2026-05-16.

**Scope:** clone SJMS-2.5 `main` (post-Phase 18A) into SJMS-5; rebrand; import 2.5 18B/18C as sub-commits; import 2.5 `docs/delivery-plan/` and `docs/KNOWN_ISSUES.md`; establish CI (typecheck, Prisma validate, unit tests, advisory lint, CodeQL, npm audit, k6 advisory); provision `docker-compose.yml`, `.env.example`, `vercel.json`, Keycloak realm, Postgres init scripts, MinIO bucket init; open issue tracker entries for every carried-over KI.

**Acceptance:** `npm run docs:check` passes; full Vitest suite green; tsc clean both workspaces; Prisma validate clean; CI green; CodeQL advisory; k6 nightly emits a result.

### Phase 1 — Finance closeout (absorb 2.5 Phase 18D–F)

**Branch:** `phase-1/finance-closeout` · **HERM:** L3

**Scope:** 18D payment plans + finance auditability; 18E sponsors / bursaries / refunds (closes KI-P10b-001); 18F closeout + finance dashboards; finance-anomaly detection job on BullMQ.

**Acceptance:** every finance sub-domain in §4.2 row 6 wired with CRUD, audit, webhook, OpenAPI, unit tests. Coverage ratchet +3pp.

### Phase 2 — Multi-tenancy substrate

**Branch:** `phase-2/multi-tenancy-substrate` · **HERM:** L8, L10 · **STOP-gate:** design doc approved (precondition acknowledged 2026-05-16).

**Scope:** promote `tenantId` to a first-class column on every operational entity (∼140 of the 199 models); adapt v4's multi-tenancy middleware to 2.5's request-ID + Winston pattern; default `tenantId = 'fhe'`; add `Tenant` model + `/api/v1/tenants` endpoints; repository layer enforces tenant scoping by default; OIDC claim mapping (Keycloak group → tenantId); migrate the 504-test suite to assert tenant isolation.

**Acceptance:** every flat router enforces tenant scoping; no repository call is tenant-blind without explicit `withSystemTenant()`; new cross-tenant access denial test suite green.

### Phase 3 — HESA / UKVI / regulatory utilities import

**Branch:** `phase-3/hesa-ukvi-regulatory` · **HERM:** L4

**Scope:** import v4's `husid-generator.ts`, `hesa-xml-generator.ts`, `heses-calculator.ts`, `classification-calculator.ts`; wire into 2.5's `hesa/` and `ukvi/` flat routers; add `compliance-regulatory` group barrel; implement HESA Data Futures mapping; build OfS/TEF regulatory module; harden UKVI compliance page; add EC claims + Appeals downstream actions; fix v4's `HesaReturns` defect (undefined `toLocaleString` on missing numerator).

**Acceptance:** HESA XML round-trips a real population; HESES calculator matches sector reference; UKVI sponsored-student attestation drives n8n escalations; EC and Appeals fire webhooks.

### Phase 4 — PGR domain

**Branch:** `phase-4/pgr-domain` · **HERM:** L2.9

**Scope:** import v4's `pgr/` API module; adapt to 2.5 patterns; add `MyResearch`, `MySupervisees`, `PgrCohort` portal pages; wire to n8n for supervision-meeting reminders, milestone overdue, viva scheduled.

**Acceptance:** PGR student record renders end-to-end; viva outcome flows to award classification; PGR-specific HESA fields populate.

### Phase 5 — Apprenticeships domain

**Branch:** `phase-5/apprenticeships-domain` · **HERM:** L2.10

**Scope:** import v4's `apprenticeships/` module; add Employer Portal (sixth portal) with `employer_admin` role; funding-claim BullMQ job → ESFA-style submission stub.

**Acceptance:** 20% OTJ hours auto-calculate; EPA gate enforced before award.

### Phase 6 — Recruitment / Enquiry CRM

**Branch:** `phase-6/recruitment-crm` · **HERM:** L2.1

**Scope:** import v4's `recruitment/` module; applicant-tariff-points distribution analytics; n8n lead nurture; marketing/admissions dashboard.

**Acceptance:** lead → applicant promotion is single-click and carries history; tariff-points analytics renders for live cohort.

### Phase 7 — Accommodation, Moodle/VLE sync, AI assistive layer

**Branch:** `phase-7/accommodation-vle-ai` · **HERM:** L2.5, L7

**Scope:** import v4's `accommodation/`, `moodle/`, `ai/` modules. AI scoped to **assistive use cases only** — student-support FAQ chatbot, admissions-decision rationale draft, attendance-anomaly summary. No autonomous decisions; every AI output flagged in UI and audit log.

**Acceptance:** accommodation lifecycle complete; Moodle sync round-trips on a test course; AI chat answers a curated FAQ set with citations.

### Phase 8 — n8n activation + UCAS/SLC/UKVI connectors

**Branch:** `phase-8/integration-activation` · **HERM:** L7

**Scope:** activate the 62 n8n templates; harden provisioning and promotion; UCAS slice; SLC slice; UKVI/CAS connector; failure handling, replay discipline, dead-letter queue, n8n observability in Prometheus.

**Acceptance:** every n8n workflow has a defined replay path; UCAS batch import round-trips on a test file; SLC reconciliation matches a fixture against the finance ledger; UKVI CAS exports to spec.

### Phase 9 — Portal completion, teaching scoping, MinIO uploads, WCAG

**Branch:** `phase-9/portal-completion` · **HERM:** L2, L5

**Scope:** 21A teaching-assignment scoping (closes KI-P10b-003); 21B MinIO presigned uploads (closes KI-P10b-002); 21C replace high-value `ComingSoon` pages; 21D notification surface improvements; 21E WCAG 2.1 AA remediation + evidence pack.

**Acceptance:** zero high-value `ComingSoon`; WCAG audit AA across staff/applicant/student routes; presigned 10 MB upload succeeds end-to-end.

### Phase 10 — Analytics, BI, dashboards, operational telemetry

**Branch:** `phase-10/analytics-bi` · **HERM:** L6

**Scope:** `sjms_reporting` schema (materialised views); role-specific dashboards (Registrar, Dean, Programme Leader, Module Leader, Finance Officer, Compliance Officer, Recruiter, Pastoral Tutor); KPI reporting (retention, NSS, engagement, at-risk, admissions funnel, finance, compliance); Report Builder UI; Prometheus alerts + runbooks + on-call rota; data export (Parquet snapshots to MinIO).

**Acceptance:** every role's primary dashboard is wired to live data; NSS-shaped survey renders; retention dashboard matches a reference spreadsheet.

### Phase 11 — AI-native operating layer (the differentiator)

**Branch:** `phase-11/ai-native-uplift` · **HERM:** cross-cutting · **STOP-gate:** design doc + ethics review approved (precondition acknowledged 2026-05-16).

The phase that takes SJMS-5 from "Banner/SITS parity" to "Banner/SITS surpassed for AI-native institutions". Scope is deliberately **augment, do not replace**. Every AI feature has an off-switch per tenant and a documented fall-back.

**Scope:**
- **RAG layer** indexed over programme specs, module specs, policies, staff handbook, HESA reference data, QA framework. Role-scoped retrieval.
- **Anthropic Claude API** (mandatory prompt caching) as primary LLM. OpenAI as feature-flag fallback.
- **Decision-support widgets** (NOT decisions): admissions next-action, attendance at-risk explanation, EC claim drafting, curriculum gap analysis, marks moderation outlier rationale.
- **Natural-language query** over reporting schema (read-only, role-scoped, generated SQL shown + approved before execution).
- **Embedding-based duplicate-applicant detection**.
- **Audit:** every invocation logged with model ID, prompt hash, response hash, user, tenant, decision path. 7-year retention.
- **Governance:** AI ethics policy, model card per use case, per-tenant opt-out, per-feature kill-switch.

**Acceptance:** every AI feature has a model card, an off-switch, and an audit trail. No AI feature has unilateral write authority on a student record. Independent ethics review signs off.

### Phase 12 — Pilot readiness and SAML federation

**Branch:** `phase-12/pilot-readiness` · **HERM:** L11, L12

**Scope:** backup/restore automation (pg_dump + MinIO snapshot + n8n export); environment promotion (dev → staging → prod); migration rehearsal from SITS or Banner extract; external security review and dependency review; support playbooks; training videos per role; **SAML federation** (operator-approved deferral); pilot gate sign-off pack (HERM matrix, compliance evidence, pentest, k6 at 2× peak).

**Acceptance:** pilot gate met. Score: HERM ≥ 8.0, security ≥ 9, observability ≥ 9, multi-tenancy ≥ 9.

---

## 6. Convergence map — at a glance

| Capability area | Source | Adapt? | Phase |
|---|---|---|---|
| Express 5 + TypeScript spine | SJMS-2.5 | No — adopt as-is | 0 |
| 44 flat routers + 9 group barrels topology | SJMS-2.5 | No | 0 |
| Repository layer | SJMS-2.5 | No | 0 |
| Prisma schema base | v4 | Yes — extend with 2.5 finance/assessment ledger | 0–2 |
| Migration history | Neither — fresh `0001_init` | n/a | 0 |
| Keycloak realm (36 roles) | SJMS-2.5 | Yes — fold v4 roles in | 0 |
| Static-secret JWT fallback | Neither — **removed** | n/a | 0 |
| MFA enforcement + SMTP block | SJMS-2.5 design | Yes — implement | 0 |
| Winston JSON + AsyncLocalStorage | SJMS-2.5 | No | 0 |
| Prometheus `/metrics` | SJMS-2.5 | No | 0 |
| OpenAPI from Zod | SJMS-2.5 | No | 0 |
| Helmet, CORS allow-list, rate limit | SJMS-2.5 | No | 0 |
| CodeQL `security-extended` | SJMS-2.5 | No | 0 |
| CODEOWNERS, SECURITY.md, PVR | SJMS-2.5 | No | 0 |
| AES-256-GCM field encryption | v4 | Yes — port to 2.5 middleware shape | 0 |
| BullMQ + Redis async | v4 | Yes — wire to new BullMQ event bus | 0 |
| MinIO 4-bucket storage | v4 | Yes — adapt with multer + presigned | 0, 9 |
| docs:check truth-pinning | SJMS-2.5 | No — extend with HERM tags | 0 |
| ESLint v9 flat configs | SJMS-2.5 | No | 0 |
| Vitest unit suite | SJMS-2.5 | No — port v4 tests opportunistically | 0 |
| k6 load scenarios | v4 | Yes — import as nightly CI | 0 |
| Finance ledger (sponsors/bursaries/refunds) | SJMS-2.5 | No — absorb in flight + close out | 1 |
| Multi-tenancy middleware + tenantId | v4 + new | Yes — fully propagate | 2 |
| HESA artefact utilities (HUSID, XML, HESES, classification) | v4 | Yes — wire to 2.5 hesa router | 3 |
| UKVI compliance page | SJMS-2.5 | No | 3 |
| EC claims + Appeals | SJMS-2.5 | No | 3 |
| OfS/TEF regulatory | v4 | Yes — adapt | 3 |
| PGR domain | v4 | Yes — adapt | 4 |
| Apprenticeships domain | v4 | Yes — adapt + new Employer portal | 5 |
| Recruitment / Enquiry CRM | v4 | Yes — adapt | 6 |
| Accommodation | v4 | Yes — adapt | 7 |
| Moodle / VLE sync | v4 | Yes — adapt | 7 |
| AI assistive (chat, embeddings) | v4 scaffolding + new | Yes — replace with Anthropic API + RAG | 7, 11 |
| 62 n8n workflow templates | v4 | Yes — correct header to `x-internal-service-key` | 8 |
| n8n PowerShell sync tooling | v4 | Yes — port to bash + ps1 | 8 |
| UCAS / SLC / Moodle / UKVI connectors | v4 scaffolding + new | Yes — implement | 8 |
| 14-stage curriculum approval pipeline | v4 | Yes — adapt | 8 |
| Teaching-assignment scoping | New (2.5 KI-P10b-003) | n/a | 9 |
| Presigned MinIO uploads | New (closes 2.5 KI-P10b-002) | n/a | 9 |
| WCAG 2.1 AA remediation | New | n/a | 9 |
| Reporting schema + dashboards | New (combines 2.5 reports + v4 analytics) | n/a | 10 |
| Anthropic Claude API + RAG layer | New | n/a | 11 |
| Backup/restore automation | New | n/a | 12 |
| SAML federation | New (Keycloak) | n/a | 12 |
| Migration rehearsal from SITS/Banner extracts | New | n/a | 12 |

---

## 7. Risks and explicit STOP-gates

| Risk | L | I | Mitigation | Phase |
|---|---|---|---|---|
| Multi-tenancy schema change touches every model and breaks tests | M | H | Phase 2 STOP-gate; design doc first; default tenant preserves single-tenant behaviour | 2 |
| AI features deployed without ethics review | L | H | Phase 11 STOP-gate; model cards mandatory; off-switch per tenant | 11 |
| n8n header-name mismatch causes silent callback failures | H | M | Fix in Phase 0 import; Phase 8 verifies | 0, 8 |
| Static-secret JWT fallback leaks into SJMS-5 | M | H | Phase 0 acceptance: production code path **removes** the fallback | 0 |
| v4's `HesaReturns` defect ports into SJMS-5 unfixed | H | M | Phase 3 explicitly fixes; defensive Zod render contract everywhere | 3 |
| Schema convergence loses real production data | L | H | Phase 12 rehearsal; canonical import script with reconciliation report | 12 |
| Coverage ratchet blocks honest churn | M | M | Floors sit 3pp below actuals (2.5 pattern); ratchet only at phase closeout | every |
| Vercel serverless cold-start kills BullMQ workers | H | M | BullMQ worker on dedicated long-running host (Railway/Render/Fly), not on Vercel | 0 |
| Anthropic API cost explosion | M | M | Mandatory prompt caching; per-tenant token budget; alerting on token rate | 11 |
| SAML federation claim outpaces evidence | M | M | Phase 12 only; OIDC parity verified end-to-end first | 12 |
| WCAG remediation scope creeps | H | L | Phase 9 explicit acceptance: AA only; AAA aspirational | 9 |

STOP-gates require explicit operator sign-off on a design doc before code lands. Phase 2, Phase 11, Phase 12.

---

## 8. Operating model summary

Full text in [`docs/SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md). Inherits SJMS-2.5's enterprise-delivery operating model:

1. Read the delivery control set before work starts.
2. One active phase branch from `main` at a time.
3. 3–8 reviewable batches per phase.
4. `report_progress` before first edit and after every batch.
5. Verification protocol after every batch.
6. PR draft, BugBot review, HIGH findings remediated.
7. No new phase until current phase is merged and control set is updated.
8. PR titles describe business outcome, not technical action.

SJMS-5 additions: HERM-tag every API barrel; model card mandatory for Phase 11+ AI features; migration justification mandatory for every Prisma model mutation.

---

## 9. AI-native architecture — design principles

This is what distinguishes SJMS-5 from Banner and SITS, neither of which has a native AI substrate.

1. **Augment, do not replace.** Every AI feature drafts; a human approves.
2. **Cited evidence by default.** No ungrounded generation in production.
3. **Per-tenant kill-switch.** Disable any AI feature per institution without re-deploy.
4. **Audit retention 7 years** (UK HE statutory).
5. **No PII in third-party training data.** `noTrain` flag set on every call.
6. **Prompt caching is mandatory.** ~90% token cost reduction on stable contexts.
7. **Model selection per use case.** Opus for high-stakes decision support; Sonnet for chat; Haiku for bulk classification. Configurable per-tenant.
8. **Embedding store separate from operational data** — dedicated `sjms_embeddings` schema with pgvector. No cross-tenant similarity search by default.
9. **Independent ethics review** before Phase 11 ships.

**Phase 11 use cases:** admissions decision support, student-support FAQ chatbot, EC claim evidence drafting, curriculum validation gap analysis, marks moderation outlier rationale (advisory only), natural-language query over reporting schema, embedding-based duplicate-applicant detection, attendance at-risk explanation.

**Out of scope for Phase 11:** autonomous offer-making, autonomous progression decisions, autonomous fee-waiver decisions, predictive classification, anything that touches a student record without explicit human approval.

---

## 10. Pilot readiness criteria — what "competitive with Tribal SITS / Banner" means

| Domain | Target | Evidence source |
|---|---|---|
| HERM v3.1 capability coverage | ≥ 8.0 weighted | Coverage matrix in `docs/herm-coverage.md` |
| Security posture | Independent pentest, no HIGH findings open | Pentest report |
| Observability | Prometheus + Loki + Grafana + alerts + runbooks live | Grafana screenshots + runbook commits |
| Multi-tenancy | Two tenants live in staging with full isolation | Tenant-isolation test report |
| Performance | k6 at 2× expected peak passes thresholds | k6 result artefact |
| Compliance | HESA Data Futures dry-run; UKVI exports; OfS B-conditions dashboard; GDPR DSR flow | Per-domain evidence pack |
| Identity | OIDC + SAML demonstrated end-to-end; MFA enforced | Realm export + SSO test report |
| AI governance | Model card + ethics review + kill-switch per use case | Model cards + signed ethics review |
| Documentation | docs:check green; every API module HERM-tagged; OpenAPI complete | docs:check artefact |
| Migration | One Tribal SITS extract round-tripped into staging | Migration rehearsal report |
| Support | Runbook tied to every Prometheus alert | Runbook commits |
| Training | Role-by-role training videos | Video links in `docs/training/` |

Meeting these criteria places SJMS-5 in the same procurement bracket as Tribal SITS, Ellucian Banner, and Workday Student for a UK HE institution between 1,000 and 30,000 students. The AI-native uplift is the differentiator.

---

## 11. Operator approvals on record (2026-05-16)

1. **Option B approved** — clone SJMS-2.5 into SJMS-5, layer v4 surface.
2. **Phase 0 mechanical import approved** — SJMS-2.5 `main` (post 18A; absorb 18B/18C as sub-commits) is the import baseline.
3. **SJMS-2.5 parallel-track decision approved** — recommended variant: freeze SJMS-2.5 at 18C, absorb 18D–F into SJMS-5 Phase 1.
4. **Multi-tenancy STOP-gate at Phase 2 approved** — design-doc precondition acknowledged.
5. **AI-native STOP-gate at Phase 11 approved** — independent ethics review precondition acknowledged.
6. **SAML deferral to Phase 12 approved** — OIDC parity verified first.

Phase 0 can begin. It is mechanical and should land in one PR.

---

## 12. Appendix — bibliography

- `SJMS_v4integrated_vs_SJMS_2.5___Comprehensive Comparative Analysis` (operator-supplied, 2026-05).
- `rjk134/sjms-2.5/README.md` — pre-production status declaration.
- `rjk134/sjms-2.5/docs/BUILD-QUEUE.md` — phase ledger (Phase 17 complete, Phase 18 in flight).
- `rjk134/sjms-2.5/docs/KNOWN_ISSUES.md` — KI register.
- `rjk134/sjms-v4-integrated/README.md` — capability inventory.
- `rjk134/sjms-v4-integrated/server/src/api/` — 42 modules verified.
- `rjk134/sjms-v4-integrated/server/src/utils/` — HUSID / HESA XML / HESES / classification utilities verified.
- HERM v3.1 — capability framework.
- Tribal SITS, Ellucian Banner, Workday Student — comparative reference products.
- HESA Data Futures specification.

---

*End of synthesis plan. See [`SJMS-5-BUILD-QUEUE.md`](SJMS-5-BUILD-QUEUE.md) for the phase queue and [`SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md) for governance.*
