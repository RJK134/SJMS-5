# SJMS 2.5 — Build Queue

> **Current Phase:** 18 — Finance Readiness (IN FLIGHT). Phase 17 — Assessment to Progression to Award is COMPLETE (Batches 17A–17F merged; KI-P14-002 closed by 17F). Phase 18A — fee calculation engine — is MERGED (PR #171). Phase 18B — invoice and charge generation — is open as PR #173 on `claude/phase-18b-invoice-generation`. Phase 18C — payment allocation — is in flight on `claude/phase-18c-payment-allocation` (stacked on 18B). Phase 18D (payment plans) and 18E (sponsors / bursaries / refunds) remain.
> **Active branches:** `claude/phase-18b-invoice-generation` (PR #173, draft), `claude/phase-18c-payment-allocation` (PR pending; stacked on 18B)
> **Base:** `main` (post-Phase 17F and 18A merges)
> **Operating model:** `docs/delivery-plan/enterprise-delivery-operating-model.md` (canonical, effective 2026-04-22)
> **Programme reference:** `docs/delivery-plan/enterprise-readiness-plan.md`
> **Governance batch:** `claude/enterprise-delivery-model-3GtVY` merged as PR #92, commit `75e43c6`, 2026-04-22.

---

## Enterprise-delivery operating model (applies to every phase)

The full operating model is canonical in `docs/delivery-plan/enterprise-delivery-operating-model.md`. The summary below is kept for quick reference only; the doc wins on any conflict.

1. Read the delivery control set before work starts: `CLAUDE.md`, `docs/BUILD-QUEUE.md`, `docs/VERIFICATION-PROTOCOL.md`, `docs/KNOWN_ISSUES.md`, `docs/delivery-plan/enterprise-delivery-operating-model.md`, `docs/delivery-plan/enterprise-readiness-plan.md`, and any phase-specific remediation or review documents.
2. Work from one active phase branch at a time from `main`.
3. Break each phase into 3–8 reviewable batches.
4. Call `report_progress` before the first edit and after every meaningful batch.
5. Run the verification protocol after each batch, plus the existing unit and E2E suites when the touched scope warrants them.
6. Push changes through `report_progress`, open or update the PR, request BugBot review, fix HIGH findings, then re-run validation.
7. Do not begin the next phase until the current phase is merged and the control set is updated.
8. PR titles describe the business outcome, not the technical action.

## Validation baseline at Phase 16 start

| Check | Result | Notes |
|---|---|---|
| `cd server && npx tsc --noEmit` | ✅ pass | KI-P16-001 closed by `chore/tooling-tsc-baseline`; TypeScript 6.0 `baseUrl` deprecation is explicitly ignored pending a future path-alias migration. |
| `cd client && npx tsc --noEmit` | ✅ pass | KI-P16-001 closed by `chore/tooling-tsc-baseline`; client typecheck now exits cleanly. |
| `DATABASE_URL=... npx prisma validate --schema=prisma/schema.prisma` | ✅ pass | Schema valid |
| `npx prisma generate --schema=prisma/schema.prisma` | ✅ pass | KI-P16-002 closed by `chore/tooling-tsc-baseline`; Prisma and `@prisma/client` are pinned to `~6.19.3` until the planned Prisma 7 migration. |
| `npm run test --workspace=server` | ✅ pass | Full Vitest suite — **186/186** tests passing on `claude/enterprise-build-step-mWIOJ` after Batches 16A–16D (was 159 after 16A+16B, 174 after 16C; +4 cascade cases in `enrolments.service.test.ts` and +8 cases in the new `clearance-checks.service.test.ts` for 16D). |
| `npm run lint` | ⚠️ advisory | ESLint v9 flat config live in both workspaces (PR #88). CI runs `Lint (advisory)` with `continue-on-error: true`; ratchet to blocking tracked under KI-P15-002. |
| Verification protocol Gates 1–12 | ✅ pass / advisory | Gates 1–2 are green again; Gates 10–12 remain advisory by design for coverage, security-observability, and lint-tooling posture. |

---

## Phase 14 — Governance, Truth Baseline, and Release Discipline

**Objective:** Establish a trustworthy delivery baseline before any new product expansion.

### Batch 14A — Delivery control set refresh
**Status:** DONE — PR #53 merged 2026-04-21
**Scope:**
- Reconciled `CLAUDE.md`, `.claude/CLAUDE.md`, `docs/BUILD-QUEUE.md`, and `docs/KNOWN_ISSUES.md` with the post-Phase 13b reality.
- Replaced stale phase summaries with the enterprise-readiness roadmap.
- Recorded the current verification baseline and known control gaps.

### Batch 14B — Enterprise-readiness plan publication
**Status:** DONE — PR #53 merged 2026-04-21
**Scope:**
- Published the phase-by-phase plan for Claude Code delivery.
- Defined the operating model, phase gates, BugBot loop, branch naming, and PR conventions.
- Sequenced open backlog items to the target phase where they should be addressed.

### Batch 14C — CI gate uplift
**Status:** DONE — PR #53 merged 2026-04-21 + Phase 14 follow-on (see Batch 14C.2)
**Scope:**
- Keep PR gating mandatory on `main`.
- Extend CI beyond the existing typecheck/test baseline with server coverage publication and clearer quality-job structure.
- Log the lint-tooling gap explicitly rather than pretending lint is enforced.

### Batch 14C.2 — CI reporting hardening (follow-on)
**Status:** DONE — commit 0d570c0
**Scope:**
- Made the server coverage summary publication step tolerant of a
  missing or malformed `coverage-summary.json`. It now annotates the
  step summary with a reporting-only note instead of failing a valid
  test run.
- Added `if: always()` to the publish and upload steps so evidence is
  produced on both pass and fail paths.
- Softened the coverage artefact upload from `if-no-files-found: error`
  to `warn`; the unit-test step remains the authoritative gate.

### Batch 14D — PR/review automation hygiene
**Status:** DONE — commit in this PR
**Scope:**
- Updated `.github/pull_request_template.md` to remove the placeholder
  `Batch 1/2/3` list in favour of a populated batches/commit-SHA list,
  added a repository-hygiene acceptance gate, and added an explicit
  pointer to the coverage artefact as testing evidence.

### Batch 14E — Low-effort follow-on cleanup
**Status:** DONE — commits 49cd99e, 6853543
**Scope:**
- Removed 891 tracked files under `.claude/worktrees/` plus three
  dangling gitlinks (`gallant-poincare`, `suspicious-beaver`,
  `suspicious-robinson`) and two stray chat transcripts leaked into
  `.claude/`. Extended `.gitignore` with `.claude/worktrees/` and
  `.claude/*.txt` so the situation cannot recur.
- Reconciled coverage policy: vitest thresholds are now authoritative
  in `server/vitest.config.ts`, CI no longer overrides them, and the
  previous aspirational-but-unenforced 60/60/50 numbers have been
  retired. Current enforcement posture is honest (0 everywhere,
  monitor-only) with a clear ratchet point in Phase 17.
- KI-P14-001 (ESLint toolchain bootstrap) intentionally deferred to a
  dedicated `chore/tooling-eslint-bootstrap` branch per its own
  resolution plan; widening scope here would risk destabilising the
  governance baseline PR.
- KI-P12-001 (enrolment cascade repository bypass) left open; its fix
  touches shared infrastructure and belongs inside Phase 16 where the
  module-registration path is already the focus.

### Batch 14F — Phase closeout
**Status:** DONE — PR #54 merged 2026-04-21 as `b9a2a58`
**Acceptance:**
- Control docs internally consistent. ✅
- CI workflow updated and green (reporting steps cannot falsely fail). ✅
- BugBot review returned Medium-Risk advisory; no HIGH findings. ✅
- Remaining AMBER/LOW items logged in `docs/KNOWN_ISSUES.md`. ✅
- Next phase branch: `phase-15/security-observability` (split from the original `phase-15/security-hardening` scope — see Phase 15 section below).

---

## Phase 15 — Security and Platform Hardening Blockers

**Objective:** Close pilot-blocking platform/security gaps incrementally, in reviewable slices, without touching architecturally-significant surface (`auth.ts`, `roles.ts`, established Prisma models) without explicit sign-off.

### Active split

The original Phase 15 plan (MFA, Redis identity cache, CSP/CORS, scanning, finance retention) has been sequenced into two branches so reviewable slices land ahead of the architectural decisions:

- **Phase 15A — Security observability and supply-chain scanning** (this PR, branch `phase-15/security-observability`). Adds static analysis, dependency scanning, disclosure policy, and code ownership. No source code or schema changes.
- **Phase 15B — Auth, MFA, identity cache, and retention** (later PR, branch `phase-15/auth-hardening`). Architecturally significant — will STOP-gate per CLAUDE.md rule 6 until Richard signs off on the approach.

### Batch 15A.1 — CodeQL static security analysis
**Status:** DONE — commit `119e73f`
**Scope:** New `.github/workflows/codeql.yml` runs CodeQL `security-extended` query suite on PR, push to main, and weekly (Mon 03:17 UTC). Scoped away from `node_modules/`, `dist/`, and `prisma/generated/`. Advisory only — findings publish to Security tab.

### Batch 15A.2 — Dependabot config
**Status:** DONE — commit `f70b4d2`
**Scope:** New `.github/dependabot.yml` watches four ecosystems (`npm` at `/`, `/server`, `/client`; `github-actions` at `/`). Weekly cadence Monday 07:00 Europe/London. Minor/patch updates grouped per ecosystem, major bumps individual. Conventional-commit prefixes match existing repo conventions.

### Batch 15A.3 — npm audit supply-chain scanning
**Status:** DONE — commit `953529c`
**Scope:** New `.github/workflows/security-audit.yml` runs `npm audit --omit=dev --json` against root/server/client on PR, push to main, and daily 04:23 UTC. Publishes a severity-count summary table to the Actions step summary and uploads raw JSON as the `security-audit-reports` artefact. Advisory only.

### Batch 15A.4 — SECURITY.md disclosure policy
**Status:** DONE — commit `b20100e`
**Scope:** New `SECURITY.md` publishes coordinated-disclosure policy with GitHub PVR as the preferred channel, 3-day ack, 7-day triage, 90-day disclosure window, safe-harbour wording, explicit in/out-of-scope list, and the current ongoing security posture.

### Batch 15A.5 — CODEOWNERS
**Status:** DONE — commit `e967c2b`
**Scope:** New `.github/CODEOWNERS` names `@RJK134` as owner for governance docs, GitHub automation, auth middleware, roles constant, Prisma schema and migrations, nginx/Docker deployment surface, and the webhook/workflow contract. Enforcement depends on branch protection's "Require review from Code Owners" toggle.

### Batch 15A.6 — Control-doc alignment
**Status:** IN PROGRESS — this PR
**Scope:** Update `docs/BUILD-QUEUE.md`, `docs/KNOWN_ISSUES.md`, `docs/VERIFICATION-PROTOCOL.md`, `CLAUDE.md`, `.claude/CLAUDE.md` to record Phase 15A delivery and the Phase 15B sequencing decision.

### Batch 15A.7 — Phase 15A closeout
**Status:** DONE — PR #55 merged 2026-04-21 as `953ed77`
**Acceptance:**
- BugBot review returned with no HIGH findings. ✅
- GitGuardian clean. ✅
- CodeQL workflow runs against the PR and returns a result (pass or advisory findings) rather than infrastructure failure. ✅
- npm audit workflow runs against the PR and publishes a summary. ✅
- Control docs list Phase 15B as the next phase-15 branch with explicit STOP-gate note. ✅

---

## Chore — ESLint Toolchain Bootstrap (KI-P14-001 closeout) — DONE

**Branch:** `chore/tooling-eslint-bootstrap`
**PR:** #88 — merged 2026-04-21 as `67df18f`
**Outcome:** ESLint v9 flat configs live at `server/eslint.config.mjs` and `client/eslint.config.mjs`. The `Lint (advisory)` CI job runs both workspaces on every PR with `continue-on-error: true` and uploads JSON reports as the `lint-reports` artefact. KI-P14-001 closed (toolchain bootstrap). Ratchet to blocking gate remains open under KI-P15-002.

---

## Governance batch — Enterprise delivery operating model (in flight)

**Branch:** `claude/enterprise-delivery-model-3GtVY`
**Base:** `main @ 0f4eaf0`
**Scope:** codify the canonical operating model for Phases 16–23 and refresh the delivery control set to reflect the merged state of Phase 15A and the ESLint toolchain chore. Docs-only.

**Deliverables:**
- `docs/delivery-plan/enterprise-delivery-operating-model.md` — new canonical operating model.
- `docs/delivery-plan/enterprise-readiness-plan.md` — baseline updated, operating-model pointer added.
- `docs/BUILD-QUEUE.md` — current phase advanced to Phase 16, ESLint chore marked DONE, Phase 16 batch plan aligned to operating-model spec.
- `docs/KNOWN_ISSUES.md` — KI-P14-001 fully closed; remaining items left open with target phases.
- `CLAUDE.md`, `.claude/CLAUDE.md` — state refreshed, pointer to operating model added.

**Acceptance:**
- Verification-protocol Gates 9 and 11 pass (docs-only change must not regress hygiene or security observability).
- No touches to source code, schema, or CI workflows.
- Control set is internally consistent after the merge.

---

## Forward phase roadmap

### Phase 15B — Auth, MFA, identity cache, and retention
**Planned branch:** `phase-15/auth-hardening`
**HERM uplift:** Identity & Access Management, operational control
**Priority outcomes:** MFA enforcement, Redis-backed identity cache, auth fallback review, CSP/CORS/Swagger tightening, finance retention safeguards. Supply-chain scanning and disclosure policy already delivered in Phase 15A.

**STOP-gate note (per CLAUDE.md rule 6):** each of the Phase 15B batches below touches `auth.ts`, `roles.ts`, the Keycloak realm JSON, or established Prisma models. Claude will not open a PR for Phase 15B without explicit approval of the technical approach. The branch will carry a design doc first.

**Candidate batches:**
- 15B.1 MFA enforcement and realm policy hardening
- 15B.2 Identity cache migration to Redis
- 15B.3 Auth fallback and environment guard review
- 15B.4 CSP/CORS/Swagger tightening (bounded review of existing headers, not new architecture)
- 15B.5 Finance retention and cascade safeguard review
- 15B.6 Phase closeout and review findings remediation

### Phase 16 — Golden Journey 1: Admissions to Enrolment
**Active branch:** `phase-16/admissions-to-enrolment`
**HERM uplift:** Learner Recruitment & Admissions, Enrolment & Registration
**Priority outcomes:** application lifecycle, offer condition logic, route handling, enrolment progression rules, finance handoff hooks, applicant/admin portal completion for the journey.
**Canonical batches (per `docs/delivery-plan/enterprise-delivery-operating-model.md` §10):**
- 16A **Application lifecycle and state enforcement — DONE** (canonical state machine in `server/src/api/applications/applications.service.ts`; `status` exposed on `applications.updateSchema`; institutional-decision states auto-stamp `decisionDate`/`decisionBy`; `application.updated` event added; 11 new Vitest cases; KI-P16-001 and KI-P16-002 logged for pre-existing TS5101 / Prisma 7 baseline regressions that are out-of-scope for this batch)
- 16B **Offer condition evaluation and admissions route handling — DONE** (exported `evaluateOfferConditionsAndAutoPromote(applicationId, userId, req)` in the applications service; auto-promotes `CONDITIONAL_OFFER → UNCONDITIONAL_OFFER` when every live condition is `MET` or `WAIVED`; routes the promotion through `applications.service.update` so the state-machine guard, audit log, `decisionDate`/`decisionBy` stamping, and `application.updated`/`application.status_changed` events all fire naturally; dedicated `application.offer_conditions_met` event on its own webhook path; `offers.service` `create`/`update`/`remove` call the evaluator after their own audit + event emission as an in-process backstop so promotion does not depend on n8n being live; +9 admissions-service cases for the helper, +6 new cases in new `offers.service.test.ts` for the offer-condition mutations)
- 16C **Applicant-to-student conversion and enrolment orchestration — DONE** (see expanded entry below)
- 16D **Module-registration edge cases — DONE** (folds in KI-P12-001; see expanded entry below)
- 16E **Admin portal completion: Convert to Student affordance — DONE** (see expanded entry below)
- 16F Evidence, tests, and closeout
- 16A **Application lifecycle and state enforcement — DONE** (canonical state machine in `server/src/api/applications/applications.service.ts`; `status` exposed on `applications.updateSchema`; institutional-decision states auto-stamp `decisionDate`/`decisionBy`; `application.updated` event added; 11 new Vitest cases; KI-P16-001 and KI-P16-002 were logged at the time for pre-existing TS5101 / Prisma 7 baseline regressions and are now closed by the tooling baseline fix)
- 16B **Offer condition evaluation and admissions route handling — DONE** (exported `evaluateOfferConditionsAndAutoPromote(applicationId, userId, req)` in the applications service; auto-promotes `CONDITIONAL_OFFER → UNCONDITIONAL_OFFER` when every live condition is `MET` or `WAIVED`; routes the promotion through `applications.service.update` so the state-machine guard, audit log, `decisionDate`/`decisionBy` stamping, and `application.updated`/`application.status_changed` events all fire naturally; dedicated `application.offer_conditions_met` event on its own webhook path; `offers.service` `create`/`update`/`remove` call the evaluator after their own audit + event emission as an in-process backstop so promotion does not depend on n8n being live; +9 admissions-service cases for the helper, +6 new cases in new `offers.service.test.ts` for the offer-condition mutations)
- 16C **Applicant-to-student conversion and enrolment orchestration — DONE** (`convertToStudent(applicationId, input, userId, req)` exported from `applications.service.ts`; idempotent: reuses existing Student/Enrolment rather than duplicating; accepts FIRM or UNCONDITIONAL_OFFER status; maps `applicationRoute → entryRoute`; generates `STU-YYYY-NNNNN` student number; calls `students.service.create()` and `enrolments.service.create()` so audit/events fire through their normal paths; emits `application.converted` on its own webhook path; `POST /applications/:id/convert` endpoint restricted to REGISTRY role; `convertSchema` added to applications.schema.ts; 15 new Vitest cases in admissions.service.test.ts; Vitest suite 174/174 passing; KI-P16-001 / KI-P16-002 closed by the tooling baseline fix)
- 16D **Cascade repository cleanup, clearance-checks test coverage, applicant/admissions UI honesty — DONE on `claude/enterprise-build-step-mWIOJ`** (two new repository helpers `findActiveByEnrolment` and `cascadeStatusForEnrolment` on `moduleRegistration.repository.ts`; `enrolments.service.update()` cascade routed through both helpers — `prisma.moduleRegistration.*` no longer touched from the service; new `clearance-checks.service.test.ts` covers create/update/status_changed/remove/NotFound paths; `MyOffers.tsx` rewritten to query the canonical `conditions` relation via `useDetail` after the scoped list, removing the silent empty state for every applicant with conditions; `MyApplication.tsx` corrected — `applicationRoute` instead of the non-existent `entryRoute`, `refereePosition`/`receivedDate` instead of the non-existent `relationship`/`status`, list-then-detail pattern so qualifications/references actually populate; `EditApplication.tsx` no longer references the non-existent `DRAFT` state in its edit-gate; `ApplicationPipeline.tsx` kanban now renders all ten canonical lifecycle stages instead of dropping INTERVIEW, INSURANCE, WITHDRAWN, REJECTED. Server Vitest suite 186/186 passing; **KI-P12-001 closed**.)
- 16E **Admin portal completion: Convert to Student affordance — DONE on `claude/phase-16e-portal-completion-WGI7g`** (`client/src/pages/admissions/ApplicationDetail.tsx` now exposes a Registry-only Convert to Student button in the page header, gated on the same `FIRM` / `UNCONDITIONAL_OFFER` whitelist the backend enforces in `applications.service.convertToStudent`; ineligible applications still render the affordance disabled with a tooltip explaining the precondition, so the action is never silently absent. The dialog collects `yearOfStudy`, `modeOfStudy`, `startDate`, `feeStatus`, and an optional `originalEntryDate`, defaults `startDate` to the September 1st boundary derived from the application's academic year, and POSTs to `/v1/applications/:id/convert` via `useMutation` from `@tanstack/react-query` so loading/error/success states are captured natively. The success path renders an Alert distinguishing a fresh conversion from an idempotent re-conversion using the backend's `isNewStudent` / `isNewEnrolment` flags, and exposes deep links to `/admin/students/:id` and `/admin/enrolments/:id` so the registrar can land directly on the resulting records. Errors surface the backend `message` (including the 403 Registry-only path) rather than a fake-success state. Server tsc, client tsc, Prisma validate/generate, ESLint of the changed file, and the full server Vitest suite (236/236) all pass. Backend remains untouched.)
- 16F Evidence, tests, and closeout. Finance handoff hooks (`enrolment.created` → automatic FeeAssessment generation) are intentionally pushed to **Phase 18A** rather than retained inside Phase 16 — the fee calculation engine is the natural carrier and avoids cross-domain entanglement.

### Phase 17 — Golden Journey 2: Assessment to Progression to Award
**Merged batches:** 17A (`ccbdc93`), 17B (`6531b28`), 17C (`017286e`)
**Active branches:** `claude/phase-17d-progression-classification` (PR #167), `claude/phase-17e-transcripts-portal` (this branch — depends on 17D)
**Planned phase branch:** `phase-17/assessment-to-award`
**HERM uplift:** Assessment, Moderation, Progression, Awards
**Priority outcomes:** marks pipeline rules, moderation/ratification states, module result generation, progression decisioning, award/classification logic, transcript-ready outputs.
**Canonical batches (per operating model §10):**
- 17A **Marks aggregation and grade-boundary application — MERGED as PR #163, commit `ccbdc93`** (pure utility `server/src/utils/marks-aggregation.ts` with deterministic weighted-average aggregation; repo helpers `assessmentAttempt.repository.ts::findForAggregation` and `moduleResult.repository.ts::findByModuleRegistrationAndYear`; service `marks.service.ts::aggregateForModuleRegistration` orchestrating preview vs persist mode; `POST /v1/marks/aggregate` endpoint; `marks.aggregated` webhook event; +14 pure-function tests + 11 service-orchestration tests; server Vitest baseline post-merge 261/261.)
- 17B **Moderation and ratification state machine — MERGED as PR #164, commit `6531b28`** (layers substantive moderation business rules on top of the 17A transition graph; `marks.service.ts::update` enforces the moderator-independence rule, the required-`moderatedMark` rule on `MARKED → MODERATED`, and auto-derives `finalMark` from `moderatedMark` (or `rawMark`) on `MODERATED → CONFIRMED` when not explicitly supplied; auto-stamps `markedDate`/`markedBy` on the MARKED edge and `moderatedDate`/`moderatedBy` on the MODERATED edge mirroring the Phase 16A pattern; `module-results.service.ts::update` auto-stamps `confirmedDate`/`confirmedBy` on the `PROVISIONAL → CONFIRMED` edge; new action-named endpoints `POST /v1/marks/:id/moderate`, `POST /v1/marks/:id/ratify`, and `POST /v1/module-results/:id/ratify` route through the canonical `update()` flow.)
- 17C **Module result generation — DONE on `claude/phase-17c-module-result-generation`** (cohort-level batch generator that runs the 17A primitive across an entire `(moduleId, academicYear)` cohort; new repo helper `moduleRegistration.repository.ts::findActiveForCohort` returns the minimum `{id, enrolmentId, status}` projection for `REGISTERED`/`COMPLETED` rows excluding `WITHDRAWN`/`DEFERRED`/`FAILED`; new service function `marks.service.ts::generateModuleResultsForCohort` orchestrates per-row aggregation through `aggregateForModuleRegistration` with idempotency-at-scale (rows whose existing ModuleResult is already CONFIRMED are reported as `skipped` rather than mutated, preserving the 17B immutability guarantee cohort-wide) and per-row error isolation (one failing row is captured into the per-row outcome with its error message but does not abort the batch); returns a structured cohort summary `{moduleId, academicYear, total, persisted, previewed, skipped, failed, results: CohortRowOutcome[]}`; lives in marks.service rather than module-results.service to avoid a circular import with `aggregateForModuleRegistration`'s persist path which already imports module-results.service; new `POST /v1/module-results/generate` endpoint TEACHING-role gated with Zod-validated body (mounted before `/:id` so the literal path wins, with the controller importing both services to wire HTTP onto the marks-service location); new `module_results.batch_generated` event on its own webhook path with cohort-level summary stats; cohort-level audit subject is the Module entity rather than individual rows so a single batch run produces one operator-driven AuditLog entry. +7 cohort-generation cases plus a small drive-by fix to 3 pre-existing tests on main that were failing due to a Phase 17B tests-vs-implementation drift on the moderatedBy-auth-match guard. Server Vitest 308/308 passing (was 297/300 on main with 3 pre-existing failures); server tsc, client tsc, Prisma validate/generate, ESLint of changed files all clean.)
- 17D **Progression decisioning and classification — DONE on `claude/phase-17d-progression-classification`** (two new pure utilities encode the canonical UK HE rules: `server/src/utils/progression-decision.ts::decideProgression` returns `PROGRESS` / `REPEAT_MODULES` / `REPEAT_YEAR` / `WITHDRAW` / `AWARD` from credit-pass accounting plus a credit-weighted average across only the rows that have an `aggregateMark` (no silent zero), with optional compensation envelope; `server/src/utils/award-classification.ts::classifyAward` returns `FIRST` / `UPPER_SECOND` / `LOWER_SECOND` / `THIRD` (LEVEL_6), `DISTINCTION` / `MERIT` / `PASS` (LEVEL_7), or `PASS` / `FAIL` (LEVEL_3-5), with explicit refusal for LEVEL_8 doctoral programmes since average-based classification is not appropriate at that level. Both utilities accept rule overrides per call so a future batch can wire ProgressionRule / ClassificationRule rows from the database without changing the contracts. New repo helpers `moduleResult.repository.ts::findForEnrolmentYear` (year-of-study results joined with module credits/level) and `findForEnrolment` (all CONFIRMED results across all years) load the inputs; idempotency lookups `progressionRecord.repository.ts::findByEnrolmentAndYear` and `awardRecord.repository.ts::findByEnrolment` underpin the upsert paths. New service orchestrators `progressions.service.ts::decideForEnrolmentYear` (derives `isPass` from `CONFIRMED + aggregateMark >= passMark` or `CONFIRMED + passing-grade` fallback; auto-detects final year from `Programme.duration` vs `Enrolment.yearOfStudy`) and `awards.service.ts::classifyForEnrolment` (CONFIRMED-only filter; upserts an AwardRecord with status `RECOMMENDED` and the programme title as the default award title); both honour the same preview-vs-persist parity established by 17A/17C. New action-named endpoints `POST /v1/progressions/decide` and `POST /v1/awards/classify` REGISTRY-role gated with Zod-validated bodies; new `progressions.decided` and `awards.classified` events on their own webhook paths; supporting webhook routes added for `progressions.created` / `progressions.updated` / `progressions.decision_changed` / `progressions.deleted` / `awards.created` / `awards.updated` / `awards.deleted` so the existing CRUD routes also resolve to dedicated workflow paths. +35 pure-function unit tests across 2 new test files (`progression-decision.test.ts` covering happy paths, all 4 failure decisions, compensation envelope rules, edge cases like empty cohort and effective-rules audit, plus `award-classification.test.ts` covering all UG-honours boundary edges, PG-taught boundaries, sub-honours pass/fail, credit weighting, explicit weight overrides for final-year uplift, missing-data handling, doctoral refusal, rounding, and rule overrides); +15 service-orchestration cases across 2 new test files (`progressions.service.test.ts` covering NotFound, preview-with-event, isPass derivation paths, persist-create, persist-update idempotency, empty-year force gate, final-year detection, audit/event payloads; `awards.service.test.ts` covering NotFound, preview, CONFIRMED-only filter, persist-create, persist-update, no-mark force gate, doctoral refusal). Server Vitest 361/361 passing (was 308/308 on `main`); server tsc, client tsc, Prisma validate/generate, ESLint of changed files all clean.)
- 17E **Award/transcript outputs and portal reflection — DONE on `claude/phase-17e-transcripts-portal`** (new pure utility `server/src/utils/transcript-composition.ts::composeTranscript` orders module results by academic year (descending) then module code (ascending), computes per-year and final credit-weighted averages, and tracks a FINAL precondition that requires a non-REVOKED AwardRecord — non-final compositions still produce a body but flag `isFinal: false` and add a diagnostic note; new repo helper `transcript.repository.ts::createWithLines` performs an atomic Transcript + TranscriptLine nested write so the transcript is never persisted without its body; new service method `transcripts.service.ts::composeForStudent` loads the student via `studentRepo.getById`, picks the most recent enrolment (or an explicit `enrolmentId`), resolves programme + moduleRegistration metadata via `enrolmentRepo.getById`, loads CONFIRMED ModuleResults via the 17D `moduleResult.repository.findForEnrolment` helper, optionally pulls an AwardRecord via the 17D `awardRecord.repository.findByEnrolment` helper, calls the pure utility, and (in persist mode) writes the row set; refuses to persist a FINAL transcript without an AwardRecord unless `force: true`; new `POST /v1/transcripts/compose` endpoint REGISTRY-role gated with Zod-validated body; `GET /v1/transcripts` widened from REGISTRY-only to `ADMIN_STAFF + TEACHING + STUDENTS` with `scopeToUser('studentId')` so the student portal can render the authenticated student's own transcripts; new `MyTranscript.tsx` page in `client/src/pages/student-portal/` wired at `/student/transcript`, fetches the most recent transcript via the scoped list endpoint and the detail endpoint for line-level rendering, groups module rows by academic year, and surfaces credit / mark / grade summary stats; emits `transcripts.composed` event on its own webhook path. +13 pure-function unit tests in new `transcript-composition.test.ts` covering header projection, year/code ordering, non-positive-credit skip, credit-weighted averages, missing-mark exclusion, per-year summaries, two-decimal rounding, INTERIM/FINAL/REVOKED award-block handling, and empty-input notes; +9 service-orchestration cases in new `transcripts.service.test.ts` covering NotFound, no-enrolment validation, INTERIM preview happy path, CONFIRMED-only filter, fallback module-title placeholder, persist happy path, FINAL refusal without AwardRecord, FINAL persist with non-REVOKED AwardRecord, explicit enrolmentId honour, and explicit-enrolment-not-found rejection. Server Vitest 383/383 passing (was 361/361 on Phase 17D base); server tsc, client tsc, Prisma validate/generate, ESLint of changed files all clean.)
- 17F **Evidence, tests, and closeout — DONE on `claude/phase-17f-closeout` (PR #170)**. Server coverage thresholds ratcheted from monitor-only `0/0/0/0` to `lines: 35`, `functions: 16`, `branches: 33`, `statements: 35` in `server/vitest.config.ts`. Floors sit ~3pp below the suite's actuals on this branch (Statements 38.39%, Branches 36.93%, Functions 18.76%, Lines 37.67%) so honest churn does not break CI but a regression below the new floor does. Single source of truth restored: `server/vitest.config.ts` is the only place the thresholds are configured. KI-P14-002 closed.

### Phase 18 — Golden Journey 3: Fees, invoicing, payments, and finance controls
**Active branch:** `claude/phase-18a-fee-calculation` (Batch 18A in flight)
**Planned phase branch:** `phase-18/finance-readiness`
**HERM uplift:** Finance & Fees Management
**Priority outcomes:** fee calculation engine, automated invoices/charges, payment allocation, account balances, finance auditability, staged finance sub-domains.
**Canonical batches (per operating model §10):**
- 18A **Fee calculation engine — MERGED via PR #171** (pure utility `server/src/utils/fee-calculation.ts::calculateFee` encoding the canonical UK HE fee rule with sensible 2025/26 defaults, three new repos, the `feeAssessments.service.assessForEnrolment` orchestrator, `POST /v1/fee-assessments/assess` FINANCE-role gated, dedicated webhook routes for `fee_assessment.created` / `fee_assessment.updated` / `fee_assessment.calculated`. +28 pure-function cases + 16 service cases.)
- 18B **Invoice and charge generation — DONE on `claude/phase-18b-invoice-generation`** (pure utility `server/src/utils/invoice-composition.ts::composeInvoiceFromAssessment` transforms a FeeAssessment outcome into a structured invoice body — single TUITION line for `finalFee` (the post-discount net the student owes; bursary/sponsor records appear in invoice notes for audit, not as separate charge lines), 30-day default due window, GBP currency, deterministic invoice number `INV-{shortYear}-{acc8}-{fa8}` so the persistence layer can resolve idempotency without a schema migration. New repo `invoice.repository.ts` (CRUD + `findByInvoiceNumber` + `createWithLines` atomic Invoice + ChargeLine + StudentAccount.balance/totalDebits/lastTransactionDate update inside a single Prisma transaction). New helper `finance.repository.findByStudentAndYear` returns the full StudentAccount row in a single round-trip. New service `invoices.service.ts::generateForFeeAssessment` orchestrates compose + persist with deterministic-invoice-number idempotency (existing rows return `skipped: true`); `force: true` bypasses with a `-R{n}` replacement counter that walks forward to find a free slot. New endpoint `POST /v1/invoices/generate` plus standard CRUD; FINANCE-role gated (DELETE is SUPER_ADMIN). New dedicated webhook routes `invoice.created` / `invoice.updated` / `invoice.generated` / `invoice.status_changed` / `invoice.deleted`. `expectedRouters` bumped 45 → 46. +21 pure-function cases + 16 service-orchestration cases. Server Vitest 464/464 passing (was 427/427 on the Phase 18A base). Server tsc, client tsc, Prisma validate/generate, docs-truth check all clean.)
- 18C **Payment allocation and account-balance logic — DONE on `claude/phase-18c-payment-allocation` (stacked on 18B)** (pure utility `server/src/utils/payment-allocation.ts::allocatePayment` distributes a Payment across open ChargeLines on the same StudentAccount with two strategies — **FIFO** (default; walks charges by dueDate then createdAt then id, fully covering each until the payment is exhausted; the last covered charge may be partial) and **PROPORTIONAL** (distributes pro rata against each charge's outstanding amount with rounding-drift absorption on the last allocation). Pure: no Prisma, no I/O — same purity contract as 17A/17D/17E/18A/18B utilities. Returns a structured outcome (per-charge allocations with `outstandingBefore` / `amount` / `fullyCovered`, `totalAllocated`, `leftover`, `fullyAllocated`, `invoiceImpact` aggregated by invoiceId, operator notes). Always satisfies the invariants `totalAllocated + leftover === paymentAmount` and `0 <= amount <= outstandingBefore`. New repos `payment.repository.ts` (CRUD with soft-delete) and `chargeLine.repository.ts` (read-mostly: `findOpenForAccount` returns non-deleted PENDING/INVOICED charges joined to non-soft-deleted invoices; `markPaidBulk` transaction-aware bulk status flip). New transaction-aware repo helpers `invoice.repository.{incrementPaidAmountInTx,findStatusProjectionInTx,updateStatusInTx}` and `finance.repository.recordPaymentLedgerEntryInTx` so the service stays repository-routed (Gate 4 clean). New service utility `utils/prisma-tx.ts::runInTransaction` wraps `prisma.$transaction` so services can open transactions without importing the Prisma client. New service `payments.service.ts::allocateForPayment` orchestrates allocate + persist atomically: marks fully-covered ChargeLines as PAID, increments `Invoice.paidAmount` per affected invoice, promotes invoice status to PAID / PARTIALLY_PAID based on post-increment paidAmount-vs-totalAmount, decrements `StudentAccount.balance` and increments `totalCredits` by the full payment amount (leftover sits as a credit balance). Refuses to allocate non-COMPLETED payments without `force: true`. New endpoints `POST /v1/payments` (standard CRUD) plus `POST /v1/payments/:id/allocate`; FINANCE-role gated (DELETE is SUPER_ADMIN). New dedicated webhook routes `payment.created` / `payment.updated` / `payment.allocated` / `payment.status_changed` / `payment.deleted`. `expectedRouters` bumped from 46 → 47. +21 pure-function cases + 19 service-orchestration cases. Server Vitest 504/504 passing (was 464/464 on the Phase 18B base). Server tsc, client tsc, Prisma validate/generate, docs-truth check all clean. Gate 4 clean.)
- 18D Payment plans and finance auditability improvements
- 18E Sponsors / Bursaries / Refunds decision batch (or Phase 18a sub-phase cut-out) — closes KI-P10b-001
- 18F Evidence and closeout

### Phase 19 — Statutory and regulatory execution
**Planned branch:** `phase-19/statutory-compliance`
**HERM uplift:** Compliance, reporting, regulatory operations
**Priority outcomes:** HESA mapping and validation, UKVI escalation workflows, EC/appeals downstream actions, regulatory audit outputs.
**Canonical batches (per operating model §10):**
- 19A HESA Data Futures mapping layer
- 19B HESA validation executor and export preparation
- 19C UKVI attendance / compliance escalation workflow completion
- 19D EC claims and appeals downstream actions / reporting
- 19E Compliance dashboards, evidence trails, and closeout

### Phase 20 — Integration activation and workflow orchestration
**Planned branch:** `phase-20/integration-activation`
**HERM uplift:** External Integration, Student Communications
**Priority outcomes:** activate the 15 n8n workflows, improve provisioning/promotion, deliver the first live external connectors (UCAS and SLC first), and add monitoring/replay discipline.
**Canonical batches (per operating model §10):**
- 20A Activate and observe the 15 n8n workflows
- 20B Harden workflow provisioning and environment promotion
- 20C UCAS integration slice
- 20D Student Loans Company integration slice
- 20E Failure handling, replay discipline, and closeout

### Phase 21 — Portal completion, academic scoping, and UX/accessibility
**Planned branch:** `phase-21/portal-completion`
**HERM uplift:** Student Self-Service, Teaching support, accessibility
**Priority outcomes:** remove priority `ComingSoon` pages, add teaching-assignment scoping, implement presigned uploads, improve communications UX, evidence WCAG 2.1 AA.
**Canonical batches (per operating model §10):**
- 21A Teaching-assignment model and academic scoping — closes KI-P10b-003
- 21B MinIO presigned upload flow and document completion — closes KI-P10b-002
- 21C Replace high-value `ComingSoon` pages
- 21D Applicant / student / staff notification surface improvements
- 21E WCAG 2.1 AA remediation and evidence
- 21F Closeout

### Phase 22 — Analytics, reporting, BI, and operational observability
**Planned branch:** `phase-22/analytics-operability`
**HERM uplift:** Analytics, BI & Reporting
**Priority outcomes:** role-specific dashboards, KPI reporting, richer operational telemetry, data export strategy, runbooks tied to metrics and logs.
**Candidate batches:**
- 22A Management dashboard baseline
- 22B Domain reporting slices
- 22C Operational telemetry and alerting
- 22D Data export and BI handoff patterns
- 22E Review and closeout

### Phase 23 — Pilot readiness and controlled enterprise deployment
**Planned branch:** `phase-23/pilot-readiness`
**HERM uplift:** Production readiness and institutional assurance
**Priority outcomes:** backup/restore automation, promotion discipline, migration rehearsal, security review, support playbooks, pilot go/no-go gate.
**Candidate batches:**
- 23A Backup/restore and environment promotion
- 23B Migration rehearsal from source SIS extracts
- 23C Security/dependency review and operational runbooks
- 23D Training artefacts and support playbooks
- 23E Pilot gate and sign-off pack

---

## Sequenced deferred items

| Item | Target phase |
|---|---|
| MFA enforcement in Keycloak | Phase 15 |
| Redis-backed identity cache | Phase 15 |
| KI-P12-001 repository-layer cleanup | Phase 14 |
| KI-P10b-001 finance sub-domains | Phase 18 / 18A |
| n8n workflow activation | Phase 20 |
| KI-P10b-002 MinIO presigned uploads | Phase 21 |
| KI-P10b-003 teaching-assignment model | Phase 21 |
| Multi-tenancy substrate | Post-Phase 23 unless commercially forced earlier |

---

## Completed phases summary

| Phase | Outcome | Status |
|---|---|---|
| Phase 8 | AMBER/GREEN workstreams closeout | Complete |
| Phase 9 | QA and production readiness baseline | Complete |
| Phase 10b | Review remediation | Complete |
| Phase 11 | System remediation | Complete |
| Phase 12 | Overnight remediation build | Complete |
| Phase 13b | Enterprise-readiness remediation pass | Complete |
