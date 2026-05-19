# SJMS-5 — Student Journey Management System
## Claude Code Master Context File

> **Organisation:** Future Horizons Education (FHE)
> **Project Lead:** Richard Knapp — Lead Developer / Architect
> **Classification:** CONFIDENTIAL | **Last Updated:** 2026-05-01
> **Operating model:** `docs/delivery-plan/enterprise-delivery-operating-model.md` — canonical for Phases 16–23.

---

## What This Project Is

SJMS 2.5 is a **unified enterprise student records system** for UK higher education, merging:

- **SJMS 2.4** (Perplexity Computer): 81 polished UI pages, clean design, MemStorage only, no auth/integrations
- **SJMS 4.0** (Claude Code): 298 Prisma models, Keycloak/36 roles, n8n, MinIO — but 26/57 staff pages served mock data, 56 P-series findings unresolved

**SJMS 2.5 = 2.4's proven UI + 4.0's enterprise infrastructure + critical gap fixes.**

## Key Reference Files (Read Before Every Phase)

| File | Purpose |
|---|---|
| `CLAUDE.md` (this file) | Project overview, rules, stack |
| `docs/architecture/system-architecture.md` | Layers, Docker, API module pattern |
| `docs/architecture/design-principles.md` | 7 governing principles |
| `docs/data-model/schema-overview.md` | 320 models, 23 domains, marks pipeline |
| `docs/standards/coding-standards.md` | TypeScript, naming, British English |
| `docs/standards/quality-gates.md` | Per-phase acceptance criteria |
| `docs/review-findings/remediation-register.md` | Known issues from v4.0 reviews |
| `docs/review-findings/cursor-copilot-strategy/review-strategy.md` | Multi-tool review cycle |
| `docs/skills-profiles/{role}.md` | Role persona for current phase |

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript + shadcn/ui + Tailwind CSS |
| Backend | Express.js + TypeScript, 37 domain modules |
| ORM | Prisma 5 → PostgreSQL 16 (pgcrypto) |
| Cache | Redis 7 |
| Auth | Keycloak 24 (OIDC, 36 roles) |
| Files | MinIO (S3-compatible) |
| Workflows | n8n (webhook-triggered) |
| Proxy | Nginx |
| Validation | Zod |
| Testing | Playwright + Vitest |

## Target Metrics

197 Prisma models · 129 pages · 271 API endpoints (57 routers) · 36 roles · 15 n8n workflows
Sub-2s page loads · Sub-500ms API (p95) · WCAG 2.1 AA · British English throughout

## Critical Rules for Claude

1. **NEVER use MemStorage or in-memory Maps** — all data via Prisma → PostgreSQL
2. **ALWAYS use British English** — enrolment, programme, colour, centre, organisation
3. **ALWAYS include audit fields** — id, createdAt, updatedAt, createdBy, updatedBy, deletedAt
4. **Phase 4+: use Prisma MIGRATIONS** — never `db push` in production phases
5. **Every mutation emits a webhook event** for n8n integration
6. **Every mutation writes to AuditLog** — entity, action, user, before/after
7. **Zod validation on ALL API inputs**
8. **No secrets in code** — credentials via environment variables only
9. **No localStorage for tokens** — memory-only (security requirement)
10. **Responsive at 1024px and 1440px**

## Memory Management

When you discover something valuable for future sessions - architectural decisions, bug fixes, gotchas, environment quirks - immediately append it to .claude/memory.md
Don't wait to be asked. Don't wait for session end.
Keep entries short: date, what, why. Read this file at the start of every session.

## PR batching rule

Claude must not create tiny incremental pull requests.

Default behaviour:
- One Claude build session = one branch = one pull request.
- Batch related fixes together.
- Do not create follow-up PRs for small fixes.
- Update the existing PR instead.
- Leave unrelated or risky work as deferred notes.
- Final merge is always left to Richard or Freddie.

## FHE Design System

Primary Navy: #1e3a5f · Slate: #334155 · Amber: #d97706 · BG: #f8fafc
Error: #dc2626 · Success: #16a34a · Cards: white + #e2e8f0 border

## Project Structure

```
SJMS-2.5/
├── CLAUDE.md                    ← YOU ARE HERE
├── .claude/prompts/             ← Phase build & verify prompts
├── docs/                        ← Architecture, standards, findings
├── server/                      ← Express API (built during phases)
├── client/                      ← React frontend
├── prisma/                      ← Schema + migrations
├── docker-compose.yml
├── n8n-workflows/
└── scripts/
```

## PR and Review Process
Every code change follows this pipeline:
1. Work on a feature branch (never commit directly to main)
2. Open a PR against main when the work is complete
3. Wait for Cursor BugBot and GitGuardian automated reviews
4. Fix any HIGH severity BugBot findings before requesting merge
5. LOW/MEDIUM findings should be noted and fixed in the same PR if quick, or logged for the next commit
6. Human reviews and merges — Claude never merges its own PRs

### Delivery Control Set
- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `docs/BUILD-QUEUE.md`
- `docs/VERIFICATION-PROTOCOL.md`
- `docs/KNOWN_ISSUES.md`
- `docs/delivery-plan/enterprise-readiness-plan.md`
- `docs/delivery-plan/enterprise-delivery-operating-model.md`

These documents must be updated together at every phase closeout. Phase 14+
uses them as the source of truth for what is current, what is deferred, and
what may be started next. From Phase 16 onward, the operating-model document
is the canonical rule set for how every phase is delivered — where it
conflicts with earlier informal practice, the operating model wins.

### Phase Delivery Model
- One active phase branch at a time from `main`
- 3–8 reviewable batches per phase
- `report_progress` before the first edit and after every meaningful batch
- Run the verification protocol plus the relevant unit/E2E suites after each batch
- Request BugBot review on every phase PR and fix HIGH findings before merge
- Do not start the next phase until the current phase is merged and the control set is updated

### Phase Gate Reviews
At the end of each build phase (per the Build Plan), a full BugBot review
is conducted across ALL changed files in that phase. No phase is considered
complete until BugBot HIGH findings are resolved.
### BugBot Severity Response
- HIGH: Must fix before merge. No exceptions.
- MEDIUM: Fix in same PR if under 10 minutes. Otherwise create an issue.
- LOW: Note in PR comments. Fix in next cleanup pass.

## Phase 6 — n8n Workflow Automation

### Workflow Definitions
- 15 version-controlled n8n workflow JSON files live in `server/src/workflows/`
- Credential template: `server/src/workflows/credentials/sjms-internal-api.json`
- Naming convention: `workflow-<domain>-<action>.json` (kebab-case, British English)

### Provisioning
- Script: `scripts/provision-n8n-workflows.ts`
- Run: `npm run provision:workflows`
- Requires `N8N_API_URL` and `N8N_API_KEY` environment variables
- Idempotent: creates new workflows, updates existing (matched by name), activates after provisioning

### Credential Usage
- n8n workflows authenticate to the SJMS API using an HTTP Header Auth credential
- Header: `x-internal-key` with value from `WORKFLOW_INTERNAL_SECRET` env var
- This must match the `INTERNAL_SERVICE_KEY` configured on the Express server
- **No secrets are embedded in workflow JSON** — all credentials are resolved at runtime via n8n environment variables
- Provisioning script creates the credential via n8n API and injects its real ID into workflow JSON
- **No secrets are embedded in workflow JSON** — credentials are stored in n8n's encrypted credential store

### How emitEvent() Connects to n8n
1. Service mutations call `emitEvent()` in `server/src/utils/webhooks.ts`
2. `emitEvent()` POSTs the webhook payload to `WEBHOOK_BASE_URL` + the path resolved by `EVENT_ROUTES`
3. n8n webhook trigger nodes listen on those paths and execute the corresponding workflow
4. Workflows call back into the SJMS API via HTTP Request nodes authenticated with the internal service key

### Rules
- **Never hardcode secrets** in workflow JSON — use `{{ $env.VARIABLE }}` expressions
- **British English** in all workflow names, node names, and task descriptions
- **One webhook path per workflow** to avoid n8n shared-path conflicts
- Workflow JSON files are the source of truth — the n8n visual editor may be used for testing but changes must be exported back to version control
3. `EVENT_ROUTES` maps each event name to a **unique** webhook path (one path per workflow)
4. n8n webhook trigger nodes listen on those paths and execute the corresponding workflow
5. Workflows call back into the SJMS API via HTTP Request nodes at `http://api:3001` (Docker service name)

### Webhook Path Scheme
Each webhook-triggered workflow has a unique path: `sjms/<domain>/<action>`.
Example: `enrolment.created` → `/webhook/sjms/enrolment/created`.
Events without a dedicated workflow fall back to prefix-based routing (e.g. `finance.*` → `/webhook/sjms/finance`).

### Rules
- **Never hardcode secrets** in workflow JSON — use n8n credential store
- **British English** in all workflow names, node names, and task descriptions
- **One webhook path per workflow** — enforced by EVENT_ROUTES exact-match routing
- Workflow JSON files are the source of truth — the n8n visual editor may be used for testing but changes must be exported back to version control

---

## Autonomous Build Loop

Claude Code follows this 10-step loop for every batch in a phase:

1. **Read** `docs/BUILD-QUEUE.md` → identify current task
2. **Implement** the task (one batch at a time)
3. **Run** `docs/VERIFICATION-PROTOCOL.md` gates
4. **Fix** any RED items
5. **Commit** with conventional commit format
6. **Trigger BugBot:** `gh pr comment <PR> --body "@cursor-bugbot please review"`
7. **Check BugBot:** `gh pr view <PR> --comments | tail -80`
8. **Fix HIGH findings** → re-trigger BugBot if needed
9. **Update** `docs/BUILD-QUEUE.md` task status
10. **Proceed** to next task OR **stop** if STOP condition reached

### Commit Format

```
<type>(<scope>): <description>
```

- **Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
- **Scope:** module name, phase, or domain (e.g., `admissions`, `phase-8`, `hesa`)
- **Description:** present tense, British English, ≤72 chars

Examples:
```
feat(accommodation): add accommodation module and repository
fix(support): include interactions in ticket detail response (KI-P5-001)
chore(docs): mark Phase 8 complete, update BUILD-QUEUE
```

### PR Format

```
gh pr create \
  --title "Phase N: <description>" \
  --body "$(cat <<'EOF'
## Summary
<one paragraph summary>

## Batches completed
- Batch NA — description (commits: abc1234, def5678)

## Acceptance criteria
- [ ] npx tsc --noEmit → 0 errors
- [ ] No hard deletes
- [ ] No direct Prisma imports in services
- [ ] British English throughout
- [ ] BugBot HIGH findings: 0 open
- [ ] GitGuardian: No secrets detected

## Known Issues resolved
- KI-XXX-XXX: description

## Known Issues remaining open
- KI-XXX-XXX: description — deferral reason

🤖 Generated with Claude Code
EOF
)"
```

### BugBot Severity Response

| Finding | Action |
|---------|--------|
| HIGH | Fix immediately. Commit `fix(<scope>): address BugBot finding — <description>`. Re-trigger BugBot. |
| MEDIUM | Fix if < 15 min effort. Otherwise log to KNOWN_ISSUES.md as AMBER. |
| LOW | Log to KNOWN_ISSUES.md as AMBER. Do not block merge. |
| False positive | Add comment: "False positive — <reason>". Proceed. |

If BugBot has not responded after 5 minutes, proceed with merge. Note in PR: "BugBot review pending at merge time."

### STOP Conditions

Stop and wait for Richard if ANY of these occur:

1. GitGuardian finds a secret in any commit
2. A migration SQL contains `DROP TABLE` or `DROP COLUMN`
3. BugBot raises the same HIGH finding across 3+ rounds
4. TypeScript errors exceed 10 and cannot be traced to current batch
5. A Prisma migration fails due to schema/database drift
6. Any task requires modifying `auth.ts`, `roles.ts`, or established Prisma models with existing data patterns
7. Any task in Phase 9 scope (production deployment, SSL, live data)
8. An architectural decision is required

When stopped:
```
STOP — [reason]
Last commit: [hash]
Branch: [name]
What was in progress: [description]
What Richard needs to decide: [specific question]
```

### KNOWN_ISSUES.md Entry Format

```markdown
### KI-P<phase>-<seq>: <short description> — OPEN <YYYY-MM-DD>

**Severity:** HIGH / AMBER / LOW
**Phase introduced:** Phase N — <phase name>
**File(s):** `path/to/file.ts`
**Problem:** <one paragraph description>
**Deferral reason:** <why this is not fixed now>
**Resolution plan:** Phase N or specific condition.

**Detection command:**
\```bash
# command to detect if issue still exists
\```
```

When closing: append `**CLOSED:** <YYYY-MM-DD> — <commit hash> — <one line description of fix>`

### Branch Naming

```
phase-<N>/<short-description>        → main phase branch
phase-<N>.<sub>/<description>        → sub-phase
fix/<ki-id>-<short-description>      → targeted KI fix
chore/<description>                  → documentation, tooling
```

### Perplexity Handover Protocol

At session end or architectural questions, prepare:
- Current HEAD — commit hash and branch
- What was completed — batches, commits, files changed
- Open KIs — full list with IDs
- What is NEXT — exact task from BUILD-QUEUE.md
- Any STOP conditions — with the specific question for Richard
- Verification state — last tsc result, BugBot status

---

**Transition map (UK HE with UCAS response states):**

```
SUBMITTED          → UNDER_REVIEW, WITHDRAWN, REJECTED
UNDER_REVIEW       → INTERVIEW, CONDITIONAL_OFFER, UNCONDITIONAL_OFFER, REJECTED, WITHDRAWN
INTERVIEW          → CONDITIONAL_OFFER, UNCONDITIONAL_OFFER, REJECTED, WITHDRAWN
CONDITIONAL_OFFER  → UNCONDITIONAL_OFFER, FIRM, INSURANCE, DECLINED, WITHDRAWN
UNCONDITIONAL_OFFER→ FIRM, INSURANCE, DECLINED, WITHDRAWN
FIRM               → WITHDRAWN
INSURANCE          → FIRM, WITHDRAWN   (results-day insurance promotion)
DECLINED, WITHDRAWN, REJECTED          (terminal)
```

**Verification (Batches 16A + 16B):**
- Server Vitest: **159/159** passing (up from 133 on `main`; +11 state-machine cases in 16A, +15 evaluator / offers.service cases in 16B)
- `npx prisma validate`: pass
- Server / client tsc: **0 new errors** — the one pre-existing `TS5101` diagnostic on each workspace is from the TypeScript 6.0 dependabot bump (PR #69) and is tracked separately under **KI-P16-001**
- `npx prisma generate`: pre-existing runtime WASM error from the Prisma 7 client bump (PR #64) — tracked under **KI-P16-002**; unit suite unaffected because tests mock Prisma

**Deliberately out-of-scope (sequenced to later batches of Phase 16):**
- 16C — Applicant-to-Student conversion and enrolment creation on `FIRM`
- 16D — Module-registration cascade repository cleanup (KI-P12-001) and finance handoff hooks
- 16E — Portal completion for the applicant/admin sides of this journey
**Conversion eligibility:** FIRM or UNCONDITIONAL_OFFER. FIRM is the primary path; UNCONDITIONAL_OFFER is accepted to support direct-entry and clearing routes.

**Batch 16D — Cascade repository cleanup, clearance-checks test coverage, and applicant/admissions UI honesty:**

| File | Change |
|---|---|
| `server/src/repositories/moduleRegistration.repository.ts` | Two new helpers: `findActiveByEnrolment(enrolmentId)` returns `{ id, moduleId }` projections of every active (`status: REGISTERED`, non-deleted) registration for an enrolment; `cascadeStatusForEnrolment(registrationId, newStatus, userId)` is a narrow `{status, updatedBy}` patch helper. Both exist solely so the enrolment cascade can route through the repository layer. |
| `server/src/api/enrolments/enrolments.service.ts` | `update()` cascade no longer calls `prisma.moduleRegistration.findMany` / `prisma.moduleRegistration.update` directly. Both calls now go through the new repository helpers, so `moduleRegistration.repository` is again the single source of truth for `prisma.moduleRegistration.*` writes. The audit + per-row `module_registration.status_changed` event emission is unchanged. **Closes KI-P12-001.** |
| `server/src/__tests__/unit/enrolments.service.test.ts` | Mock surface switched from `prisma.moduleRegistration` to the two new repository helpers. Four new cases cover WITHDRAWN cascade (two registrations, both via the repo helper), INTERRUPTED → DEFERRED cascade, no-cascade-when-enrolment-becomes-active, and no-cascade-when-no-active-registrations (with the parent `enrolment.status_changed` event still firing once). |
| `server/src/__tests__/unit/clearance-checks.service.test.ts` | **New file.** 8 cases — `getById` happy path + NotFound; `create()` audit + `clearance_checks.created` event; `update()` emits `updated` and `status_changed` on a status flip; `update()` does not emit `status_changed` when only metadata changes; `update()` rejects an unknown id with NotFound; `remove()` soft-deletes + audits + emits `clearance_checks.deleted`; `remove()` rejects an unknown id with NotFound. Closes the only admissions-domain service that previously had zero unit-test coverage. |
| `client/src/pages/applicant/MyOffers.tsx` | Was rendering the empty state for every applicant with conditions — the page typed against `app.offers` (no such relation; the Prisma relation is `conditions`) and `o.deadline` (no such field). Rewritten to type against the canonical `OfferCondition` shape, fetch via `useDetail` after `useList` so the `conditions` relation is hydrated by `admissions.repository.defaultInclude`, render the application status as a header card, distinguish "no offers yet" from "unconditional offer / no outstanding conditions" honestly, and surface `targetGrade` instead of an invented `deadline`. |
| `client/src/pages/applicant/MyApplication.tsx` | Three drift fixes. `app.entryRoute` → `app.applicationRoute` (entry route lives on the Student record, not the Application). `Reference.relationship` → `Reference.refereePosition` and `Reference.status` → `Reference.receivedDate`-derived "RECEIVED / PENDING" badge (the schema has `refereePosition`/`receivedDate`, no `relationship`/`status`). The list-only data path is replaced with `useList` → `useDetail` so qualifications and references actually populate (the list endpoint omits both relations). |
| `client/src/pages/applicant/EditApplication.tsx` | The `canEdit = ['DRAFT', 'SUBMITTED'].includes(app.status)` guard referenced a `DRAFT` state that does not exist in the canonical enum — no application would ever satisfy the DRAFT branch. Now gates explicitly on `app.status === 'SUBMITTED'`, with a comment explaining why later states are read-only. |
| `client/src/pages/admissions/ApplicationPipeline.tsx` | The kanban view rendered six stages and silently dropped any application currently in INTERVIEW, INSURANCE, WITHDRAWN, or REJECTED. All ten canonical stages now render. Layout switched from a fixed 6-column grid to a horizontally scrollable flex strip with fixed-width columns so each stage stays readable on a 1024px viewport. |

**Verification (Batches 16A + 16B + 16C + 16D):**
- Server Vitest: **186/186** passing (up from 174 on main after 16C; +4 cascade cases in `enrolments.service.test.ts`, +8 cases in the new `clearance-checks.service.test.ts`).
- Server tsc: ✅ clean after `chore/tooling-tsc-baseline` closed **KI-P16-001**.
- Client tsc: ✅ clean after `chore/tooling-tsc-baseline` closed **KI-P16-001**.
- `npx prisma validate` / `prisma generate`: ✅ clean after `chore/tooling-tsc-baseline` closed **KI-P16-002** by pinning Prisma back to `~6.19.3`; the Prisma 7 migration remains a future planned branch.
- `grep -n "prisma\.moduleRegistration" server/src/api/enrolments/enrolments.service.ts` → 0 hits (KI-P12-001 detection command).

**Batch 16E — Admin portal completion: Convert to Student affordance:**

| File | Change |
|---|---|
| `client/src/pages/admissions/ApplicationDetail.tsx` | Adds a Registry-only "Convert to Student" affordance to the admissions ApplicationDetail page header. The button is gated on the same `FIRM` / `UNCONDITIONAL_OFFER` whitelist (`CONVERTIBLE_STATUSES`) the backend enforces in `applications.service.convertToStudent`; ineligible applications still render the affordance in a disabled state with a tooltip explaining the precondition (and showing the current status), so the action is never silently absent for an admissions officer trying to understand why it is unavailable. The dialog collects `yearOfStudy`, `modeOfStudy`, `startDate`, `feeStatus`, and an optional `originalEntryDate`, defaults `startDate` to the September 1st boundary derived from the application's `academicYear`, and POSTs to `/v1/applications/:id/convert` via `useMutation` from `@tanstack/react-query` so loading/error/success states are captured natively. The success path renders an Alert that distinguishes a fresh conversion from an idempotent re-conversion using the backend's `isNewStudent` / `isNewEnrolment` flags, and exposes deep links to `/admin/students/:id` and `/admin/enrolments/:id` so the registrar can land directly on the resulting records. Errors surface the backend `message` (including the 403 Registry-only path, the 404 not-found path, and the 400 ineligible-status path) rather than a fake-success state. No backend changes — this batch consumes the existing endpoint introduced in Batch 16C. |

**Verification (Batch 16E):**
- Server tsc: ✅ clean (no server changes; baseline preserved).
- Client tsc: ✅ clean.
- `prisma validate` / `prisma generate`: ✅ clean (using the repository-pinned `./node_modules/.bin/prisma`, currently v6.19.3 per **KI-P16-002** resolution).
- Server Vitest: **236/236** passing (carried over from this branch's baseline; Batch 16E does not exercise server code).
- ESLint of `client/src/pages/admissions/ApplicationDetail.tsx`: ✅ clean (no warnings, no errors).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope:**
- Server-side changes (the convert endpoint, schema, role guard, and idempotency contract are all already in place from Batch 16C and remain untouched).
- Finance handoff hooks (`enrolment.created` → automatic FeeAssessment generation) sequenced to **Phase 18A** as carried over from the Batch 16D out-of-scope note — the fee calculation engine is the natural carrier and avoids cross-domain entanglement.

---

## Phase 17 — Assessment to Progression to Award (COMPLETE)

**Merged batches:** 17A (PR #163, commit `ccbdc93`), 17B (PR #164, commit `6531b28`), 17C (PR #166, commit `017286e`), 17D (PR #167), 17E (PR #168), 17F (closeout — server coverage ratchet, KI-P14-002 closed)

Second vertical golden journey — the academic rules engine. Batch 17A delivered the marks aggregation primitive. Batch 17B layered the moderation and ratification business rules on top of the 17A transition graph. Batch 17C delivered the cohort-level batch generator. Batch 17D delivered the progression-decisioning and degree-classification rules engine. Batch 17E delivered transcript composition outputs and the student-portal reflection that makes the academic outcome visible to students. Batch 17F ratcheted server Vitest coverage thresholds and closed the Phase 17 control set.

**Batch 17A — Marks aggregation and grade-boundary application:**

| File | Change |
|---|---|
| `server/src/utils/marks-aggregation.ts` | **New file.** Pure, side-effect-free `aggregateMarks(attempts)` utility implementing the canonical UK HE weighted-average rule: `percentage_i = (finalMark_i / maxMark_i) * 100`, `contribution_i = percentage_i * (weighting_i / sum(weightings))`, aggregate rounded to 2 dp once at the end (matching the `Decimal(6, 2)` precision on `AssessmentAttempt.finalMark` and `ModuleResult.aggregateMark`). Missing finalMark values are excluded from both numerator and denominator (no silent zero) and reported via `missingAssessmentIds` + `isComplete=false`. Defensive guards skip non-positive maxMark (divide-by-zero) and non-positive weighting. |
| `server/src/repositories/assessmentAttempt.repository.ts` | Adds `findForAggregation(moduleRegistrationId, options)` returning a flat `{id, assessmentId, finalMark, maxMark, weighting, status}` projection (joins `assessment.weighting` / `assessment.maxMark`). Optional `statuses` filter so the caller can restrict to `['CONFIRMED']` for a definitive aggregation or include `MARKED` / `MODERATED` for a pre-board preview. Avoids the include tree's enrolment + student + person joins which aggregation does not need. |
| `server/src/repositories/moduleResult.repository.ts` | Adds `findByModuleRegistrationAndYear(moduleRegistrationId, academicYear)` for idempotency lookup. The pair acts as a logical unique key for the aggregation upsert path — a real DB UNIQUE constraint is a 17B/17C decision that touches the schema. |
| `server/src/api/marks/marks.service.ts` | Adds `aggregateForModuleRegistration(moduleRegistrationId, options, userId, req)`. Two operating modes — preview (default) and persist (opt-in). Preview computes the aggregate, optionally resolves a grade against a caller-supplied `boundaryAssessmentId` via the existing `resolveGradeFromMark` utility, and emits `marks.aggregated` with `persisted: false`. Persist mode additionally upserts the `ModuleResult` through `module-results.service` (so its existing audit + `module_results.created` / `module_results.updated` events fire on their normal paths). Refuses to overwrite a `CONFIRMED` ModuleResult (immutability guarantee from 17B). Refuses to persist when `isComplete=false` or when contributing weightings ≠ 100; both gates can be overridden with `force: true` for operational fix-ups. Default `attemptStatuses` is `['CONFIRMED']`. |
| `server/src/api/marks/marks.schema.ts` | Adds `aggregateSchema` Zod validator exposing `moduleRegistrationId`, `attemptStatuses`, `boundaryAssessmentId`, `persist`, and `force`. |
| `server/src/api/marks/marks.controller.ts` | Adds `aggregate(req, res, next)` thin handler. |
| `server/src/api/marks/marks.router.ts` | Adds `POST /v1/marks/aggregate` mounted before the `/:id` dynamic route so the literal path wins. Restricted to `ROLE_GROUPS.TEACHING` (the same group that can create / update individual marks). |
| `server/src/utils/webhooks.ts` | Adds `marks.aggregated → /webhook/sjms/marks/aggregated` to `EVENT_ROUTES` (one path per workflow, prefix fallback retained). |
| `server/src/utils/grade-boundaries.ts` | Removes the `TODO [P1]: Implement mark aggregation endpoint (POST /v1/marks/aggregate)` comment that was the original priority-actions #5 placeholder. Replaced with a forward-pointer to the new utility + service. |
| `server/src/__tests__/unit/marks-aggregation.test.ts` | **New file.** 14 pure-function cases — empty input; equal weightings; asymmetric weightings; non-100 normalising sum; non-uniform maxMark scaling; rounding (33.33⅓ → 33.33, 49.995 → 50); missing component non-contribution; all-missing → null aggregate; non-positive maxMark divide-by-zero guard; zero-weighted skip; complete-with-zeros isComplete=true. |
| `server/src/__tests__/unit/marks.service.test.ts` | Adds 11 `aggregateForModuleRegistration()` cases — NotFound on unknown moduleRegistration; preview happy path with audit + event; `attemptStatuses` passthrough; grade resolution with and without `boundaryAssessmentId`; persist→create when no existing ModuleResult; persist→update existing PROVISIONAL; refuse-overwrite-CONFIRMED; refuse-incomplete-without-force; force-override-incomplete records `force: true` in event; refuse-no-attempts; refuse-non-100%-weighting; zero-attempts preview still emits `marks.aggregated`. |

**Verification (Batch 17A):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean (using the repository-pinned `./node_modules/.bin/prisma` v6.19.3 per **KI-P16-002** resolution).
- Server Vitest: **261/261** passing (was 236/236 on `main`; +14 pure-function cases in `marks-aggregation.test.ts`, +11 service-orchestration cases appended to `marks.service.test.ts`).
- ESLint of changed files: 0 errors. Two pre-existing `@typescript-eslint/no-explicit-any` warnings on lines I did not touch in `assessmentAttempt.repository.ts:21` and `moduleResult.repository.ts:19`; no new violations introduced.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (Prisma model count 196, router count 44, role count 36).
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service method imports the repository helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 17):**
- 17B — Moderation and ratification state machine (the AssessmentAttempt status guards live as a 17A precursor; the moderation workflow surface, second-marker reconciliation, and board minutes are 17B).
- 17C — Module result generation as a managed pipeline (17A delivers the primitive; 17C will drive batch generation across a cohort).
- 17D — Progression decisioning and classification, including module-level grade boundaries and degree classification logic. The current 17A grade resolution falls back on per-Assessment GradeBoundary rows because module-level boundaries do not exist in the schema yet.
- 17E — Award / transcript outputs and portal reflection.
- Frontend surface for aggregation. The endpoint exists and is testable via API, but the cohort-preview / one-click-aggregate UI is sequenced to 17C / 17E.

**Batch 17B — Moderation and ratification state machine:**

| File | Change |
|---|---|
| `server/src/api/marks/marks.service.ts` | Layers four moderation business rules on top of the 17A transition graph: (1) **moderator independence** — `moderatedBy` MUST differ from `markedBy`, enforced both on the `MARKED → MODERATED` edge (with the authenticated user inferred when no explicit `moderatedBy` is supplied) and on a `moderatedBy`-only patch made after MODERATED has been recorded; (2) **required `moderatedMark`** on the MODERATED transition — the patch must supply one or the row must already carry one, otherwise the call is rejected with a clear error rather than producing a moderated-but-empty record; (3) **`finalMark` resolution** on the `MODERATED → CONFIRMED` edge — the service auto-derives `finalMark` from `moderatedMark` (or `rawMark` for non-moderated assessments) when the caller does not supply it explicitly, closing the "ratified with no recorded outcome" failure mode that the previous CRUD surface allowed; (4) **audit-field auto-stamping** — `markedDate`/`markedBy` on the MARKED edge and `moderatedDate`/`moderatedBy` on the MODERATED edge are stamped from the authenticated user when not supplied, mirroring the Phase 16A `decisionDate`/`decisionBy` pattern on Application. Adds `moderateAttempt(id, input, userId, req)` and `ratifyAttempt(id, input, userId, req)` action functions that route through `update()` so the state-machine guard, audit, and existing events all fire on their normal paths. The `ratifyAttempt` action carries an explicit terminal-state check that rejects re-ratifying an already-CONFIRMED row (instead of silently no-opping when `incomingStatus === previous.status`). |
| `server/src/api/marks/marks.schema.ts` | Adds `moderateSchema` (`{moderatedMark, feedback?}`) and `ratifySchema` (`{finalMark?, grade?}`) Zod validators for the new action endpoints. |
| `server/src/api/marks/marks.controller.ts` | Adds `moderate(req, res, next)` and `ratify(req, res, next)` thin handlers. |
| `server/src/api/marks/marks.router.ts` | Adds `POST /v1/marks/:id/moderate` and `POST /v1/marks/:id/ratify`. Both routes are mounted before the generic `PATCH /:id` so the literal action paths win, validate against the new schemas, and are restricted to `ROLE_GROUPS.TEACHING` (the same group authorised to mark/amend individual attempts). |
| `server/src/api/module-results/module-results.service.ts` | Auto-stamps `confirmedDate`/`confirmedBy` on the `PROVISIONAL → CONFIRMED` edge during ratification — same pattern as the AssessmentAttempt stamping above. The existing `assertAllAttemptsConfirmed` cross-entity guard remains in place. Adds the `ratifyModuleResult(id, input, userId, req)` action function that routes through `update()`, with an explicit terminal-state check that rejects re-ratifying a CONFIRMED row. |
| `server/src/api/module-results/module-results.schema.ts` | Adds `ratifySchema` (`{boardId?}`) for the new action endpoint. |
| `server/src/api/module-results/module-results.controller.ts` | Adds `ratify(req, res, next)` thin handler. |
| `server/src/api/module-results/module-results.router.ts` | Adds `POST /v1/module-results/:id/ratify` mounted before the generic `PATCH /:id`, validated against the new schema, restricted to `ROLE_GROUPS.TEACHING`. |
| `server/src/__tests__/unit/marks.service.test.ts` | +17 new cases plus 3 inline edge-fixture additions to the existing parametric loop (the loop now seeds `moderatedMark` / `markedBy` on the previous row so 17B's field-requirement guards accept the same valid edges 17A defined). New cases cover: MODERATED rejection without moderatedMark; acceptance with moderatedMark in same patch; acceptance when moderatedMark already on row; moderatedDate/moderatedBy auto-stamping; explicit moderatedBy override; independence rejection (authenticated vs explicit `moderatedBy` matching `markedBy`); independence on a `moderatedBy`-only patch; null-`markedBy` does not raise the guard; CONFIRMED `finalMark` auto-derivation from moderatedMark; rawMark fallback; rejection when no source mark exists; explicit `finalMark` override; markedDate/markedBy auto-stamping on the SUBMITTED → MARKED edge; `moderateAttempt` happy path; rejection when not in MARKED status; rejection when moderator equals marker; `ratifyAttempt` happy path with auto-derived finalMark; explicit finalMark/grade override; both `marks.ratified` and `marks.released` emitted; rejection re-ratifying a CONFIRMED row. |
| `server/src/__tests__/unit/module-results.service.test.ts` | +7 new cases covering: confirmedDate/confirmedBy auto-stamping on the PROVISIONAL → CONFIRMED edge; non-stamping on REFERRED / DEFERRED transitions; `ratifyModuleResult` happy path with `module_results.ratified` event emission; cross-entity guard rejection when AssessmentAttempts remain non-CONFIRMED; rejection re-ratifying a CONFIRMED row. |

**Verification (Batch 17B):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **289/289** passing (was 261/261 on `main` after Phase 17A; +24 new cases plus 3 inline edge-fixture additions).
- ESLint of changed files: 0 errors, 0 warnings.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass.
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty.
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 17):**
- SecondMarkingRecord and AnonymousMarking service / API surface (the schema models exist; second-marker reconciliation and anonymous-marker reveal flows are deliberately deferred to a 17B follow-on or 17C — the canonical state machine and required-field rules are the priority for this batch).
- Module-level grade boundaries and degree classification logic — Phase 17D.
- Cohort-level batch ratification / module result generation pipeline — Phase 17C.
- Frontend moderation UI (the endpoints are testable via API; the staff portal screens for moderation/ratification are sequenced to 17C / 17E).

**Batch 17C — Module result generation:**

| File | Change |
|---|---|
| `server/src/repositories/moduleRegistration.repository.ts` | Adds `findActiveForCohort(moduleId, academicYear)` returning the minimum projection (`{id, enrolmentId, status}`) for every non-deleted ModuleRegistration in `REGISTERED` or `COMPLETED` status. Excludes `WITHDRAWN`/`DEFERRED`/`FAILED` (no result is generated for those operationally). The flat projection avoids the include tree's enrolment + student + person joins that the cohort generator does not need, keeping the hot path cheap when batch-generating across hundreds of rows. |
| `server/src/api/marks/marks.service.ts` | Adds `generateModuleResultsForCohort(moduleId, academicYear, options, userId, req)`. Loads the active cohort via the new repo helper, then runs the 17A primitive `aggregateForModuleRegistration` per row inside a `try/catch` so per-row failures (incomplete aggregation, missing maxMark, broken weighting) are captured into the per-row outcome rather than aborting the whole cohort. **Idempotency-at-scale:** rows whose existing ModuleResult is already CONFIRMED are reported as `skipped` rather than mutated, preserving the 17B immutability guarantee cohort-wide. **Summary accounting:** returns `{moduleId, academicYear, total, persisted, previewed, skipped, failed, results: CohortRowOutcome[]}` so operators see the real picture. **Cohort-level audit:** subject is the Module entity (not individual rows); the per-row aggregations already audit themselves through `aggregateForModuleRegistration` / `module-results.service` when they fire. The function lives in `marks.service` rather than `module-results.service` to avoid a circular import: `marks.service` already imports `module-results.service` for the per-row aggregate-persist path, so reversing the dependency would create a cycle. |
| `server/src/api/marks/marks.service.ts` (types) | Adds `CohortGenerationOptions`, `CohortGenerationOutcome`, and `CohortRowOutcome` interfaces. The per-row outcome distinguishes `'persisted'` / `'previewed'` / `'skipped'` / `'failed'` so the operator UI can render each case differently without parsing the underlying aggregation flags. |
| `server/src/api/module-results/module-results.schema.ts` | Adds `generateSchema` Zod validator exposing `moduleId`, `academicYear` (with the existing `\d{4}\/\d{2}` shape regex), `attemptStatuses`, `boundaryAssessmentId`, `persist`, and `force`. `ATTEMPT_STATUSES` is re-imported from `marks/marks.schema` so the cohort generator and the per-row aggregator always accept the same enum. |
| `server/src/api/module-results/module-results.controller.ts` | Adds `generate(req, res, next)` thin handler. Imports `marks.service` directly so HTTP routing on the module-results router can dispatch to the marks-service-located implementation without further indirection. |
| `server/src/api/module-results/module-results.router.ts` | Adds `POST /v1/module-results/generate` mounted **before** the `/:id` dynamic routes so the literal path wins over the dynamic match. Restricted to `ROLE_GROUPS.TEACHING` (the same group authorised to mark / amend individual marks and ratify module results). |
| `server/src/utils/webhooks.ts` | Adds `module_results.batch_generated → /webhook/sjms/module-results/batch-generated` to `EVENT_ROUTES` (one path per workflow, prefix fallback retained). |
| `server/src/__tests__/unit/marks.service.test.ts` | +7 cohort-generation cases — empty cohort happy path with `total: 0` summary and event emission; preview-mode aggregation across a 2-row cohort; CONFIRMED-skip idempotency (existing CONFIRMED ModuleResult blocks generation, aggregator does NOT run); per-row failure isolation (3-row cohort with 1 throw — bad row reported as `failed` with reason captured, other 2 succeed); persist-mode happy path with `module-results.service.create` being called; option passthrough (`attemptStatuses`, `boundaryAssessmentId`, `persist`, `force` all forwarded to the per-row aggregator and reflected in the cohort `module_results.batch_generated` event); cohort-level audit subject is `Module` (not per-row). Plus a small drive-by fix to **3 pre-existing tests** that were failing on `main` from a Phase 17B tests-vs-implementation drift on the `moderatedBy must match the authenticated user` guard — the old tests expected an "explicit moderatedBy override" semantic that the merged service rejects; replaced with cases that match the post-merge behaviour. |

**Verification (Batch 17C):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **308/308** passing (was 297/300 on `main` with 3 pre-existing failures from the Phase 17B tests-vs-implementation drift — the drive-by fix in this PR closes those failures, so the recorded baseline 308/308 represents both the +7 cohort cases and the +1 added test from the moderator-explicit-match drive-by).
- ESLint of changed files: 0 errors. One pre-existing `@typescript-eslint/no-explicit-any` warning on `moduleRegistration.repository.ts:26` (line I did not touch); no new violations introduced.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass.
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the cohort generator imports the repo helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope:**
- Module-level grade boundaries and degree classification logic — Phase 17D.
- Award / transcript outputs and portal reflection — Phase 17E.
- Frontend cohort-generation UI (the endpoint is testable via API; the staff portal screens for the operator-driven "generate cohort results" workflow are sequenced to 17E).
- Schema-level UNIQUE constraint on `(moduleRegistrationId, academicYear)` for ModuleResult — the cohort generator and the 17A aggregator both treat the pair as a logical unique key, but the migration is not in this batch.

**Batch 17D — Progression decisioning and classification:**

| File | Change |
|---|---|
| `server/src/utils/progression-decision.ts` | **New file.** Pure, side-effect-free `decideProgression(input)` utility encoding the canonical UK HE progression rules. Inputs: `{moduleResults, programmeLevel, yearOfStudy, isFinalYear?, rules?}`. Returns one of `PROGRESS` / `REPEAT_MODULES` / `REPEAT_YEAR` / `WITHDRAW` / `AWARD`. Defaults: 120 credits per year, `compensationMinMark: 30`, `withdrawThresholdRatio: 0.5` (i.e. WITHDRAW when `totalCreditsPassed` is below half the year's full credit total). Compensation is opt-in via `maxCompensatedCredits`. The credit-weighted average ignores modules with no `aggregateMark` (no silent zero — same contract as 17A). Captures `effectiveRules` in the outcome for audit traceability. |
| `server/src/utils/award-classification.ts` | **New file.** Pure `classifyAward(input)` utility. Inputs: `{moduleResults, programmeLevel, rules?}`. UG honours (LEVEL_6) → `FIRST` ≥70 / `UPPER_SECOND` ≥60 / `LOWER_SECOND` ≥50 / `THIRD` ≥40 / `FAIL` <40. PG taught (LEVEL_7) → `DISTINCTION` ≥70 / `MERIT` ≥60 / `PASS` ≥50 / `FAIL` <50. Sub-honours (LEVEL_3 to LEVEL_5) → `PASS` ≥40 / `FAIL` <40. Doctoral (LEVEL_8) is refused with an explicit reason since classification by weighted average is not appropriate. Modules with no `aggregateMark` are excluded and reported via `excludedModuleIds`. Per-module `weight` overrides the default credit-as-weight so the caller can pre-compute final-year uplifts (e.g. doubling final-year weights). Final average rounded to 2dp. |
| `server/src/repositories/moduleResult.repository.ts` | Adds `findForEnrolmentYear(enrolmentId, academicYear)` returning the projection `{id, moduleId, credits, level, aggregateMark, grade, status}` joined via `moduleRegistration.enrolmentId`; and `findForEnrolment(enrolmentId, options)` for the multi-year award lookup, defaulting to `statuses: ['CONFIRMED']` (only ratified results count toward classification). |
| `server/src/repositories/progressionRecord.repository.ts` | Adds `findByEnrolmentAndYear(enrolmentId, academicYear)` — idempotency lookup for the decisioner upsert path. |
| `server/src/repositories/awardRecord.repository.ts` | Adds `findByEnrolment(enrolmentId)` — idempotency lookup for the classifier upsert path. |
| `server/src/api/progressions/progressions.service.ts` | Adds `decideForEnrolmentYear(enrolmentId, academicYear, options, userId, req)`. Loads the enrolment + year ModuleResults, derives per-module `isPass` from `CONFIRMED + aggregateMark >= passMark` or `CONFIRMED + grade in PASSING_GRADES` fallback (mirroring the existing `utils/pass-marks` set), calls `decideProgression`, and (in persist mode) upserts a ProgressionRecord through the existing `create` / `update` paths so audit + `progressions.created` / `progressions.updated` / `progressions.decision_changed` events fire normally. Auto-detects final year from `Programme.duration` vs `Enrolment.yearOfStudy`. Default per-level pass marks: 40 (L3-L6), 50 (L7-L8); overridable per call. Refuses `persist:true` on an empty-year input without `force:true`. Emits `progressions.decided` with the full structured outcome. |
| `server/src/api/awards/awards.service.ts` | Adds `classifyForEnrolment(enrolmentId, options, userId, req)`. Loads the enrolment + all CONFIRMED ModuleResults, calls `classifyAward`, and (in persist mode) upserts an AwardRecord (status `RECOMMENDED`, programme title as the default award title) through the existing `create` / `update` paths. Refuses `persist:true` when no contributing module has an `aggregateMark` without `force:true`. Emits `awards.classified` with the full structured outcome. |
| `server/src/api/progressions/progressions.schema.ts` | Adds `decideSchema` Zod validator exposing `enrolmentId`, `academicYear`, `passMark`, `rules{fullYearCredits/maxCompensatedCredits/compensationMinMark/withdrawThresholdRatio}`, `persist`, `force`. |
| `server/src/api/awards/awards.schema.ts` | Adds `classifySchema` Zod validator exposing `enrolmentId`, `rules{honoursBoundaries/pgtBoundaries/subHonoursPassMark}`, `persist`, `force`. |
| `server/src/api/progressions/progressions.controller.ts` | Adds `decide(req, res, next)` thin handler. |
| `server/src/api/awards/awards.controller.ts` | Adds `classify(req, res, next)` thin handler. |
| `server/src/api/progressions/progressions.router.ts` | Adds `POST /v1/progressions/decide` mounted before the `/:id` dynamic routes so the literal path wins. Restricted to `ROLE_GROUPS.REGISTRY` (the same group authorised to create / amend ProgressionRecord rows). |
| `server/src/api/awards/awards.router.ts` | Adds `POST /v1/awards/classify` mounted before `/:id`, REGISTRY-role gated. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes for `progressions.created` / `progressions.updated` / `progressions.decision_changed` / `progressions.decided` / `progressions.deleted` and `awards.created` / `awards.updated` / `awards.classified` / `awards.deleted`, replacing the prefix-based fallback so each event has a one-path-per-workflow route. |
| `server/src/__tests__/unit/progression-decision.test.ts` | **New file.** 23 pure-function cases — happy-path PROGRESS, AWARD on final-year, credit-weighted average ignores missing marks, null-average for no-mark cohorts; failure decisioning (REPEAT_MODULES with one fail, REPEAT_YEAR with 4 fails above the WITHDRAW threshold, WITHDRAW below 50%); compensation rules (compensable failure within envelope, refused below `compensationMinMark`, capped at `maxCompensatedCredits`); edge cases (empty cohort with explicit reason, non-positive credits skipped, effective rules captured for audit). |
| `server/src/__tests__/unit/award-classification.test.ts` | **New file.** 12 pure-function cases — UG honours boundary edges (table-driven across the 70/60/50/40/0 boundaries), PG taught boundaries, sub-honours pass/fail; credit weighting (default credit-as-weight, explicit per-module weight for final-year uplift); missing-data handling (excluded modules reported); LEVEL_8 doctoral refusal; rounding to 2dp; rule overrides (custom honours boundaries). |
| `server/src/__tests__/unit/progressions.service.test.ts` | **New file.** 9 service-orchestration cases — NotFound on unknown enrolment; preview emits `progressions.decided` without persisting; `isPass` derivation from `CONFIRMED + aggregateMark >= passMark`; `isPass` fallback from `CONFIRMED + passing-grade`; non-CONFIRMED rows treated as fails; persist-create when no existing row; persist-update existing row (idempotent); reject empty-year persist without force; final-year detection → AWARD; audit + event payload includes `passMark` / `force`. |
| `server/src/__tests__/unit/awards.service.test.ts` | **New file.** 6 service-orchestration cases — NotFound; preview happy path emits `awards.classified` without persisting; CONFIRMED-only filter passed to the repo; persist-create new AwardRecord; persist-update existing AwardRecord (idempotent); reject persist-without-marks unless force; doctoral programme refusal at the service boundary too. |

**Verification (Batch 17D):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **361/361** passing (was 308/308 on `main` after Phase 17C; +53 new cases across 4 new test files).
- ESLint of changed files: 0 errors. 3 pre-existing `@typescript-eslint/no-explicit-any` warnings on lines I did not touch (`awardRecord.repository.ts:17`, `moduleResult.repository.ts:19`, `progressionRecord.repository.ts:15`); no new violations introduced.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass.
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service methods import the repo helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 17):**
- DB-backed `ProgressionRule` and `ClassificationRule` rule loading. The schema models exist but have no service / API surface yet; the 17D utilities use sensible UK HE defaults overridable per call. Wiring DB rules is a 17D follow-on or 17E task.
- Final-year weighting policy (e.g. doubling final-year weights, ignoring penultimate-year modules entirely). The classifier accepts a per-module `weight` so callers can pre-compute the policy externally; baking it into the service is sequenced to 17E with the transcript outputs.
- Award / transcript outputs and portal reflection — Phase 17E.

**Batch 17E — Award / transcript outputs and portal reflection:**

| File | Change |
|---|---|
| `server/src/utils/transcript-composition.ts` | **New file.** Pure `composeTranscript(input)` utility takes student + programme + ModuleResults + optional AwardRecord and returns a structured payload (header / lines / yearSummaries / totals / award / isFinal / notes). Ordering: academic year descending, module code ascending. Per-year and final averages are credit-weighted across rows that have an `aggregateMark` (rows without are excluded — same "no silent zero" contract as 17A). FINAL transcripts require a non-REVOKED AwardRecord; without one, the composer still produces a body but sets `isFinal: false` and emits a diagnostic note so the service layer can refuse to persist. Two-decimal rounding once at the end. Pure — no Prisma, no I/O. |
| `server/src/repositories/transcript.repository.ts` | Adds `createWithLines(transcript, lines)` that uses Prisma's nested-write so the parent Transcript and its TranscriptLine children are persisted in a single transaction, included via the `lines` relation in the returned payload. The transcript is never persisted without its body. |
| `server/src/api/transcripts/transcripts.service.ts` | Adds `composeForStudent(studentId, options, userId, req)`. Loads the student via `studentRepo.getById`, picks the most recent non-deleted enrolment (or an explicit `enrolmentId`), resolves programme + module-code/title metadata via `enrolmentRepo.getById`'s include tree, loads CONFIRMED ModuleResults via the 17D `moduleResult.repository.findForEnrolment` helper, optionally pulls an AwardRecord via `awardRecord.repository.findByEnrolment`, calls the pure utility, and (in persist mode) writes a Transcript + TranscriptLine row set via the new repository helper. Refuses to persist a FINAL transcript without an AwardRecord unless `force: true`. Audit subject is the Student entity (a transcript is conceptually attached to the student). Emits `transcripts.composed` with the structured payload. |
| `server/src/api/transcripts/transcripts.schema.ts` | Adds `composeSchema` Zod validator exposing `studentId`, optional `transcriptType` (defaults to INTERIM in the service), optional `enrolmentId`, `persist`, `force`. The `studentId` field on the existing `querySchema` is preserved with its docstring updated to note it is now also injected by `scopeToUser('studentId')`. |
| `server/src/api/transcripts/transcripts.controller.ts` | Adds `compose(req, res, next)` thin handler. |
| `server/src/api/transcripts/transcripts.router.ts` | Adds `POST /v1/transcripts/compose` mounted before the `/:id` dynamic routes so the literal path wins; REGISTRY-role gated. The existing `GET /v1/transcripts` is widened from REGISTRY-only to `ADMIN_STAFF + TEACHING + STUDENTS` with `scopeToUser('studentId')` middleware so the student portal can render the authenticated student's own transcripts. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes for `transcripts.created` / `transcripts.updated` / `transcripts.composed` / `transcripts.deleted` so each transcript event has a one-path-per-workflow route. |
| `client/src/pages/student-portal/MyTranscript.tsx` | **New file.** Read-only student-portal page rendering the authenticated student's most recent transcript. Fetches the scoped list via `useList` for the candidate, then `useDetail` for the full body with TranscriptLine children. Groups module rows by academic year, displays credit/mark/grade with status-coloured badges, and surfaces summary stats (modules / total credits / average mark). Honest empty state when no transcript has been issued. |
| `client/src/pages/student-portal/StudentRouter.tsx` | Adds `Route path="/student/transcript" component={MyTranscript}` between the existing marks and timetable routes. |
| `server/src/__tests__/unit/transcript-composition.test.ts` | **New file.** 13 pure-function cases — header projection; year-descending + code-ascending ordering; non-positive-credits skip with diagnostic note; credit-weighted final average; rows-without-mark excluded from the average but counted in totalCredits; per-year summaries in descending order; two-decimal rounding; FINAL with AwardRecord populates the award block and sets `isFinal: true`; FINAL without AwardRecord flags `isFinal: false` and notes; FINAL with REVOKED AwardRecord flags `isFinal: false` and notes; INTERIM transcripts always isFinal=true; empty-input diagnostic. |
| `server/src/__tests__/unit/transcripts.service.test.ts` | **New file.** 9 service-orchestration cases — NotFound on unknown student; ValidationError when student has no enrolment; INTERIM preview with default options; CONFIRMED-only filter passed to the moduleResult repo; placeholder module-title fallback when registration metadata is missing; persist:true atomic write of Transcript + TranscriptLine; FINAL persist refusal without AwardRecord; FINAL persist with non-REVOKED AwardRecord; explicit `enrolmentId` honour; explicit-enrolmentId-not-on-student rejection. |

**Verification (Batch 17E):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean.
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **383/383** passing (was 361/361 on the Phase 17D base; +22 new cases across 2 new test files).
- ESLint of changed files: 0 errors. One pre-existing `@typescript-eslint/no-explicit-any` warning on `transcript.repository.ts:15` (line I did not touch); no new violations introduced.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass.
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service method imports the repo helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (beyond Batch 17E):**
- PDF rendering of the transcript payload — the structured `TranscriptComposition` shape is intentionally rendering-engine-agnostic so a future batch can wire a PDF/email pipeline (likely under Phase 20 alongside the n8n communications activation).
- Certificate generation — the schema has a `certificateNumber` column on AwardRecord, but issuing physical/digital certificates is sequenced to a Phase 21+ portal completion task.
- Replacement-transcript provenance tracking. The schema's `REPLACEMENT` TranscriptType is supported by the composer, but tracking the relationship between a REPLACEMENT and the original is a Registry workflow concern that belongs to a follow-on.

**Batch 17F — Evidence, tests, and closeout (server coverage ratchet):**

| File | Change |
|---|---|
| `server/vitest.config.ts` | Coverage thresholds raised from the Phase 14 follow-on monitor-only floor of `0/0/0/0` to `lines: 35`, `functions: 16`, `branches: 33`, `statements: 35`. Numbers were chosen by measuring the suite on this branch — Statements 38.39% (`791/2060`), Branches 36.93% (`554/1500`), Functions 18.76% (`122/650`), Lines 37.67% (`729/1935`) — and sitting ~3 percentage points below each actual to leave headroom for honest churn. The header docstring records the choice rationale and explicitly disclaims that the floor is sized to catch regression rather than drive new test creation; future ratchets in Phase 18+ bump these numbers in this single file. The CLI overrides removed in the Phase 14 follow-on remain absent so `server/vitest.config.ts` stays the single source of truth and local runs and CI enforce identical thresholds. |
| `docs/KNOWN_ISSUES.md` | KI-P14-002 closed with a verification command pointing at the new floor. |
| `docs/BUILD-QUEUE.md` | Phase 17F marked DONE; Phase 17 retired from the IN FLIGHT line; Phase 18A added as the next executable slice on `claude/phase-18a-fee-calculation`; `Current Phase` advanced to Phase 18. |
| `docs/phase-status.json` | Phase 17 marked complete; Phase 18 marked in flight. |
| `CLAUDE.md`, `.claude/CLAUDE.md` | Phase 17F closeout recorded; Phase 17 retired from the IN FLIGHT line. |

**Verification (Batch 17F):**
- Server tsc: ✅ clean (no source changes in this batch).
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **383/383** passing — same suite as Phase 17E (no new tests in this batch; the ratchet measures existing coverage rather than adding to it).
- Server Vitest with coverage: ✅ EXIT=0 against the new `35/16/33/35` floor (Statements 38.39%, Branches 36.93%, Functions 18.76%, Lines 37.67% all clear the floor).
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass.
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.
- Verification protocol Gate 10 — coverage policy: previously empty (CLI overrides absent); still empty after the ratchet. The `KI-P14-002` detection command `grep -E 'lines:\s*0|functions:\s*0|branches:\s*0' server/vitest.config.ts` is now empty, confirming the ratchet has taken effect.

**Phase 17 status at this batch's close:**
Phase 17 — Assessment to Progression to Award is complete. All six canonical batches (17A marks aggregation, 17B moderation/ratification, 17C cohort generation, 17D progression decisioning + classification, 17E transcript outputs + portal reflection, 17F evidence + closeout + coverage ratchet) are merged. Server Vitest baseline post-merge: 383/383 passing across 23 files. The next executable phase is Phase 18 — Finance Readiness, starting with Batch 18A (fee calculation engine).

---

## Phase 18 — Finance Readiness (IN FLIGHT, Batches 18A + 18B + 18C)

**Active branches:** 18A merged (PR #171), `claude/phase-18b-invoice-generation` (PR #173, draft), `claude/phase-18c-payment-allocation` (PR pending; stacked on 18B)
**Base:** `main` (post-17F + 18A merges)
**Planned phase branch:** `phase-18/finance-readiness`

Third vertical golden journey — the finance rules engine. Batch 18A delivers the fee calculation primitive: a pure utility that computes a UK HE fee from `(programmeLevel × feeStatus × creditsTaken × modeOfStudy)` with bursary and sponsor deductions, plus a service orchestrator that loads the inputs from the live data model and (optionally) persists a `FeeAssessment` row. Batch 18B delivers the invoice and charge generation pipeline: a pure utility that transforms a FeeAssessment outcome into a structured invoice body, plus a service orchestrator that atomically writes Invoice + ChargeLine + StudentAccount ledger updates in a single transaction. Batch 18C delivers the payment allocation pipeline: a pure utility that distributes a Payment across open ChargeLines (FIFO or proportional), plus a service orchestrator that flips fully-covered charges to PAID, increments invoice paidAmounts, promotes invoice statuses to PAID/PARTIALLY_PAID, and updates the StudentAccount ledger atomically. Subsequent batches layer payment plans and the broader finance sub-domains on top.

**Batch 18A — Fee calculation engine:**

| File | Change |
|---|---|
| `server/src/utils/fee-calculation.ts` | **New file.** Pure, side-effect-free `calculateFee(input)` utility encoding the canonical UK HE fee rule: `baseFee = perCreditRate(feeStatus, programmeLevel) × creditsTaken; totalFee = round(baseFee × modeMultiplier, 2); discount = min(bursaryTotal + sponsorTotal, totalFee × maxDiscountRatio); finalFee = round(max(0, totalFee − discount), 2)`. Default tariff (overridable per call): HOME UG £77/credit, HOME PGT £108, HOME PGR £75; OVERSEAS UG £146, OVERSEAS PGT £200, OVERSEAS PGR £180; EU_TRANSITIONAL → OVERSEAS rates; ISLANDS / CHANNEL_ISLANDS → HOME rates. Mode multipliers default to FULL_TIME 1.0, PART_TIME 0.5, SANDWICH 1.0, DISTANCE 0.8, BLOCK_RELEASE 0.6. Discount cap (`maxDiscountRatio`) defaults to 1.0 (full waiver allowed) and clamps inputs outside `[0, 1]` back to default. Non-positive / non-finite contribution amounts are silently skipped. Negative `creditsTaken` is treated as zero (no negative billing). All amounts are rounded to 2 dp at the boundary, mirroring the `Decimal(10, 2)` precision on `FeeAssessment.totalFee/finalFee`. Pure: no Prisma, no I/O. Same purity contract as `aggregateMarks` (17A), `decideProgression` / `classifyAward` (17D), and `composeTranscript` (17E). |
| `server/src/repositories/feeAssessment.repository.ts` | **New file.** Standard CRUD repository for the existing `FeeAssessment` Prisma model (no soft-delete column on the schema). Adds `findLatestByEnrolment(enrolmentId)` returning the most recent FeeAssessment by `assessedDate`. The fee assessor upserts against this lookup so re-running an assessment for an enrolment updates the existing row by default rather than creating a duplicate; `force: true` on the persist path bypasses the lookup and writes a fresh historical row instead. |
| `server/src/repositories/sponsorAgreement.repository.ts` | **New file.** Minimal helper `findActiveByStudentYear(studentId, academicYear)` returns active SponsorAgreement rows for the (student, year) pair via a single Prisma call (joined through `studentAccount: { studentId }`). Used by the fee assessor to compose the sponsor-contribution input. The full sponsor management surface (CRUD, allocation, AP reconciliation) is sequenced to a later 18 batch. |
| `server/src/repositories/bursaryApplication.repository.ts` | **New file.** Minimal helper `findAwardedByStudent(studentId, academicYear)` returns BursaryApplication rows in `APPROVED` or `PAID` status — both states have a confirmed `awardAmount` that should reduce the fee. `SUBMITTED` / `UNDER_REVIEW` / `REJECTED` rows are excluded. Used by the fee assessor to compose the bursary-deduction input. |
| `server/src/utils/repository-sort-allow-lists.ts` | Adds `FEE_ASSESSMENT_SORT` covering `id`, `enrolmentId`, `feeStatus`, `assessedDate`, `totalFee`, `finalFee`, `createdAt`, `updatedAt` for `safeOrderBy`. |
| `server/src/api/fee-assessments/fee-assessments.service.ts` | **New file.** Service orchestrator. `assessForEnrolment(enrolmentId, options, userId, req)` loads the enrolment via `enrolmentRepo.getById` (throws NotFound if missing), validates that the programme has a `level` and a `creditTotal` (or accepts a `creditsTaken` override), pulls awarded bursaries and active sponsor agreements via the new repo helpers, calls the pure `calculateFee` utility, and (in persist mode) upserts a FeeAssessment through the existing service `create`/`update` paths so audit and `fee_assessment.created` / `fee_assessment.updated` events fire on their normal paths. Refuses to persist when `outcome.totalFee === 0` unless `force: true` (operators occasionally want a £0 row for a fully-waived assessment). The persist path defaults to **update existing** when `findLatestByEnrolment` returns a row (idempotent re-run); `force: true` bypasses that and creates a brand-new historical record. The `Decimal` ↔ `number` conversion is handled by a local `toNumber` helper that accepts both shapes (Decimal, number, string) so the service stays repository-routed. Audit subject is the Enrolment entity (a fee assessment is conceptually attached to an enrolment year); the per-row CREATE/UPDATE audits fire separately through the service create/update path. Emits `fee_assessment.calculated` with the structured payload (totalFee, discountAmount, finalFee, effectiveRules, bursary/sponsor references, notes, persisted, feeAssessmentId, force). |
| `server/src/api/fee-assessments/fee-assessments.schema.ts` | **New file.** Zod validators: `paramsSchema`, `querySchema` (cursor/limit/sort/order plus `enrolmentId` and `feeStatus` filters), `createSchema` / `updateSchema` for direct CRUD, and `assessSchema` for the action endpoint exposing `enrolmentId`, optional `creditsTaken`, optional `rules` (perCreditRates, modeMultipliers, maxDiscountRatio), `persist`, and `force`. |
| `server/src/api/fee-assessments/fee-assessments.controller.ts` | **New file.** Thin handlers: `list`, `getById`, `create`, `update`, plus `assess` for the new endpoint. |
| `server/src/api/fee-assessments/fee-assessments.router.ts` | **New file.** `POST /v1/fee-assessments/assess` is mounted **before** the `/:id` dynamic routes so the literal action path wins. All routes are FINANCE-role gated (`ROLE_GROUPS.FINANCE` covers `finance_director`, `finance_manager`, `finance_officer`). |
| `server/src/api/index.ts` | Wires `feeAssessmentsRouter` at `/v1/fee-assessments` next to the existing `financeRouter`. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes: `fee_assessment.created → /webhook/sjms/fee-assessment/created`, `fee_assessment.updated → /webhook/sjms/fee-assessment/updated`, `fee_assessment.calculated → /webhook/sjms/fee-assessment/calculated`. One path per workflow, prefix-fallback retained for any legacy `finance.*` events. |
| `scripts/check-docs-truth.mjs` | `expectedRouters` bumped from 44 → 45 to reflect the new `fee-assessments.router.ts`. |
| `CLAUDE.md` "Target Metrics" line | Router count bumped from 44 → 45. |
| `server/src/__tests__/unit/fee-calculation.test.ts` | **New file.** 28 pure-function cases — default tariff sanity (HOME L4 FT 120cr → £9,240; OVERSEAS UG > HOME UG; PGT > UG; PGR dedicated tariff; EU_TRANSITIONAL ≡ OVERSEAS; ISLANDS / CHANNEL_ISLANDS ≡ HOME); mode multipliers (PART_TIME × 0.5, DISTANCE × 0.8, BLOCK_RELEASE × 0.6, SANDWICH × 1.0); credit handling (linear scaling, zero credits diagnostic, negative-credits-as-zero); bursaries and sponsor contributions (sum, combined discount, finalFee floor at zero, `maxDiscountRatio` cap with note, non-positive/non-finite skip); rule overrides (per-credit override, mode multiplier override, missing-cell fallthrough, negative override rejected, ratio clamp); rounding to 2 dp; effectiveRules for audit; breakdown preservation; determinism. |
| `server/src/__tests__/unit/fee-assessments.service.test.ts` | **New file.** 16 service-orchestration cases — `assessForEnrolment` NotFound, ValidationError on missing `programme.level` and missing `programme.creditTotal`, preview happy path + event emission, `creditsTaken` override, bursary + sponsor deduction (Decimal-as-string compat), `(studentId, academicYear)` filter passthrough, refuse-zero-totalFee-without-force, persist-create-when-no-existing, persist-update-when-existing-idempotent, force-creates-historical-row, rule-override forwarding, audit subject is Enrolment; `getById` NotFound; `create` audit + event; `update` previous-read + audit + event. |

**Verification (Batch 18A):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **427/427** passing (was 383/383 on the Phase 17E base; +28 pure-function cases in `fee-calculation.test.ts`, +16 service-orchestration cases in `fee-assessments.service.test.ts`).
- Server Vitest with coverage: Statements 39.96%, Branches 38.18%, Functions 20.00%, Lines 39.23% — all above the new Phase 17F floor of `35/16/33/35` (which lands when PR #170 merges).
- ESLint of changed files: 0 errors.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (router count now 45).
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service method imports the repo helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 18):**
- 18B Invoice and charge generation on enrolment states. Once a FeeAssessment is persisted, the natural next step is generating a corresponding Invoice + ChargeLine through the StudentAccount ledger; that wiring (and the `enrolment.created` → automatic-assessment hook carried over from the Batch 16D out-of-scope note) belongs to 18B.
- 18C Payment allocation and account-balance logic.
- 18D Payment plans and finance auditability improvements.
- DB-backed rule loading from `SystemSetting` (or a future dedicated `FeeBand` model). The 18A utility accepts a per-call `rules` argument and exposes `effectiveRules` in the outcome, so a downstream batch can wire a default-resolver that reads from `SystemSetting` without changing the contract.
- Discounted second-year / placement-year tariffs (e.g. £1,850 SANDWICH placement year). The mode multipliers default for SANDWICH is currently 1.0; an institution can override per-call. The richer `(yearOfStudy, modeOfStudy) → multiplier` matrix is a downstream batch.
- Frontend surface for fee assessment. The endpoint is testable via API; the staff portal screens for the operator-driven "calculate fee" workflow are sequenced to a later 18 batch alongside the StudentAccount ledger view.

**Batch 18B — Invoice and charge generation:**

| File | Change |
|---|---|
| `server/src/utils/invoice-composition.ts` | **New file.** Pure, side-effect-free `composeInvoiceFromAssessment(input)` utility transforms a FeeAssessment outcome into a structured invoice body (header + chargeLines). Default policy (overridable per call): single TUITION line for `finalFee` (the post-discount amount the student actually owes — bursary/sponsor deductions are already applied at the FeeAssessment layer and recorded in invoice notes for audit traceability rather than as separate charge lines). Defaults: 30-day due window from issueDate; GBP currency; deterministic invoice number `INV-{shortYear}-{acc8}-{fa8}` so the persistence layer can resolve idempotency without a schema migration adding a `feeAssessmentId` FK; `DRAFT` initial invoice status; `PENDING` initial line status. The composer is the canonical "FeeAssessment → invoice body" translation step. Pure: no Prisma, no I/O. Same purity contract as `aggregateMarks` (17A), `decideProgression` / `classifyAward` (17D), `composeTranscript` (17E), and `calculateFee` (18A). |
| `server/src/repositories/invoice.repository.ts` | **New file.** Standard CRUD repository for the existing `Invoice` Prisma model with soft-delete via `deletedAt`. Adds `findByInvoiceNumber(invoiceNumber)` for the deterministic-invoice-number idempotency lookup; adds `createWithLines(invoice, lines, options)` performing an atomic Invoice + ChargeLine nested write inside a Prisma `$transaction` so the invoice is never persisted without its body. Within the same transaction, `StudentAccount.balance` and `totalDebits` are incremented by the sum of charge amounts and `lastTransactionDate` is stamped — keeping the ledger and the billing surface consistent (mirrors and lifts the existing `finance.repository.createCharge` primitive to the multi-line invoice level). The atomic balance update can be opted out via `options.incrementAccountBalance: false` for migration / replay scenarios. |
| `server/src/repositories/finance.repository.ts` | Adds `findByStudentAndYear(studentId, academicYear)` returning the full `StudentAccount` row (distinct from the existing `getAccountBalance` balance-only projection). Lets the invoice generator resolve the account in a single round-trip without dragging in the include tree. |
| `server/src/utils/repository-sort-allow-lists.ts` | Adds `INVOICE_SORT` (`id`, `invoiceNumber`, `issueDate`, `dueDate`, `totalAmount`, `paidAmount`, `status`, `createdAt`, `updatedAt`) and `CHARGE_LINE_SORT` (`id`, `chargeType`, `amount`, `status`, `dueDate`, `createdAt`, `updatedAt`) for `safeOrderBy`. |
| `server/src/api/invoices/invoices.service.ts` | **New file.** Service orchestrator. `generateForFeeAssessment(feeAssessmentId, options, userId, req)` loads the FeeAssessment via `feeAssessmentRepo.getById`, resolves the linked enrolment + StudentAccount (via `enrolmentRepo.getById` + `financeRepo.findByStudentAndYear` or an explicit `studentAccountId` override that is cross-checked against the enrolment's studentId/academicYear), calls the pure composer, and (in persist mode) writes the row set via the new repository helper. Idempotency is keyed on the deterministic invoice number — re-runs return the existing row with `skipped: true` rather than mutating it. `force: true` bypasses idempotency by appending a `-R{n}` counter suffix that walks forward (capped at 100 iterations) to find a free slot, preserving the original record. Refuses to persist when no StudentAccount exists with a clear error directing the operator to create one via `POST /v1/finance` first. The Decimal ↔ number conversion is handled by a local `toNumber` helper that accepts Decimal/number/string shapes so the service stays repository-routed. Standard CRUD (`list` / `getById` / `create` / `update` / `remove`) covers the create-/amend-existing-Invoice flow with audit + `invoice.created` / `invoice.updated` / `invoice.status_changed` / `invoice.deleted` events. The action endpoint also emits `invoice.generated` regardless of preview/persist/skipped mode so n8n integrations can react to a generation attempt without inferring it from the row-level CREATE. |
| `server/src/api/invoices/invoices.schema.ts` | **New file.** Zod validators: `paramsSchema`, `querySchema` (cursor/limit/sort/order plus `studentAccountId` / `status` / `invoiceNumber` filters), `createSchema` / `updateSchema` for direct CRUD, and `generateSchema` for the action endpoint exposing `feeAssessmentId`, optional `studentAccountId` / `issueDate` / `dueDate` / `currency` / `invoiceNumber`, optional `rules` (`defaultDueDays`, `tuitionChargeType`, `tuitionTaxCode`, `initialStatus`, `initialLineStatus`), `persist`, and `force`. |
| `server/src/api/invoices/invoices.controller.ts` | **New file.** Thin handlers: `list`, `getById`, `create`, `update`, `remove`, plus `generate` for the new endpoint. |
| `server/src/api/invoices/invoices.router.ts` | **New file.** `POST /v1/invoices/generate` mounted **before** `/:id` so the literal action path wins. All routes are FINANCE-role gated; `DELETE /:id` is SUPER_ADMIN-only. |
| `server/src/api/index.ts` | Wires `invoicesRouter` at `/v1/invoices` next to the existing `feeAssessmentsRouter`. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes: `invoice.created → /webhook/sjms/invoice/created`, `invoice.updated → /webhook/sjms/invoice/updated`, `invoice.generated → /webhook/sjms/invoice/generated`, `invoice.status_changed → /webhook/sjms/invoice/status-changed`, `invoice.deleted → /webhook/sjms/invoice/deleted`. One path per workflow. |
| `scripts/check-docs-truth.mjs` | `expectedRouters` bumped from 45 → 46 to reflect the new `invoices.router.ts`. |
| `CLAUDE.md` "Target Metrics" line | Router count bumped from 45 → 46. |
| `server/src/__tests__/unit/invoice-composition.test.ts` | **New file.** 21 pure-function cases — single TUITION line happy path, finalFee (not totalFee) on discount, deterministic invoice-number scheme, explicit invoice-number override, default 30-day due window, `defaultDueDays` override, explicit dueDate override, custom currency, `tuitionTaxCode` stamp on line + effectiveRules, omit-taxCode when undefined, `tuitionChargeType` override (e.g. RESIT), `initialStatus` + `initialLineStatus` override, two-decimal rounding, description includes year + programme + yearOfStudy, missing-programme description fallback, bursary/sponsor reference notes, zero-amount note for record-keeping, effectiveRules audit capture, determinism, academicYear shape fallback, empty-string reference filtering. |
| `server/src/__tests__/unit/invoices.service.test.ts` | **New file.** 16 service-orchestration cases — `generateForFeeAssessment` NotFound on missing FeeAssessment, NotFound on missing enrolment, ValidationError on missing StudentAccount, ValidationError on explicit-studentAccountId-not-matching-enrolment, preview happy path with `invoice.generated` event emission, persist-create with `invoice.created` + Invoice CREATE audit, persist-skipped with `skipped:true` when invoiceNumber already exists, force-bypass-with-`-R1`-replacement, rule overrides forwarded (defaultDueDays + tuitionTaxCode), explicit invoiceNumber override, Decimal-as-string compat; `getById` NotFound, `create` audit + event, `update` previous-read + audit + event with status_changed, `update` no-op status_changed when status unchanged, `remove` soft-delete + audit + event. |

**Verification (Batch 18B):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **464/464** passing (was 427/427 on the Phase 18A base; +21 pure-function cases in `invoice-composition.test.ts`, +16 service-orchestration cases in `invoices.service.test.ts`).
- ESLint of changed files: 0 errors.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (router count now 46).
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service method imports the repo helpers, not the Prisma client).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 18):**
- 18C Payment allocation and account-balance logic. The Invoice + ChargeLine row set 18B persists is the natural input for an allocation pipeline; the next batch reads open ChargeLines, applies a Payment against them (FIFO by dueDate, or proportional), and updates `Invoice.paidAmount` + `StudentAccount.balance` atomically.
- 18D Payment plans and finance auditability improvements.
- 18E Sponsors / Bursaries / Refunds decision batch — closes KI-P10b-001.
- The `enrolment.created → automatic FeeAssessment + Invoice` cross-domain hook. The 18B endpoint is API-callable from anywhere (including an enrolment service listener); wiring the listener itself is sequenced to a Phase 20 integration-activation task to keep finance and enrolment domains decoupled until n8n is the integration layer.
- Frontend surface for invoice generation. The endpoint is testable via API; the staff portal screens for the operator-driven "generate invoice" workflow and the StudentAccount ledger view are sequenced to a later 18 batch.

**Batch 18C — Payment allocation:**

| File | Change |
|---|---|
| `server/src/utils/payment-allocation.ts` | **New file.** Pure `allocatePayment(input)` utility with two strategies: **FIFO** (default; walks open charges by dueDate then createdAt then id, fully covering each until the payment is exhausted; the last covered charge may be partial) and **PROPORTIONAL** (distributes pro rata against each charge's outstanding amount with rounding-drift absorption on the last allocation so `sum(allocations) === pool` exactly to 2 dp). Pure: no Prisma, no I/O — same purity contract as `aggregateMarks` (17A), `decideProgression` / `classifyAward` (17D), `composeTranscript` (17E), `calculateFee` (18A), and `composeInvoiceFromAssessment` (18B). Returns a structured outcome with per-charge allocations (`outstandingBefore`, `amount`, `fullyCovered`), `totalAllocated`, `leftover`, `fullyAllocated` flag, `invoiceImpact` aggregated by invoiceId, and operator notes (no-open-charges, overpayment, no-charges-fully-covered). Negative payment amounts are treated as zero; zero-outstanding charges are silently skipped. Always satisfies the invariants `totalAllocated + leftover === paymentAmount` and `0 <= amount <= outstandingBefore`. |
| `server/src/repositories/payment.repository.ts` | **New file.** Standard CRUD for the existing `Payment` Prisma model with soft-delete via `deletedAt`. |
| `server/src/repositories/chargeLine.repository.ts` | **New file.** Read-mostly repository for ChargeLine. `findOpenForAccount(studentAccountId)` returns the minimum projection of non-deleted PENDING/INVOICED ChargeLines for an account, joined to non-soft-deleted invoices (so a cancelled invoice's lines never reappear). Includes ad-hoc charges (invoiceId null) so legacy `finance.repository.createCharge` rows are still allocatable. `markPaidBulk(ids, userId, tx)` is the transaction-aware bulk status flip used by the payment-allocation pipeline. Direct CRUD on ChargeLine is intentionally not exposed — a charge always belongs to an invoice and the invoice is the system-of-record entity for the operator surface. |
| `server/src/repositories/invoice.repository.ts` | Adds three transaction-aware helpers used by the payment-allocation pipeline: `incrementPaidAmountInTx(id, amount, tx)` increments `paidAmount`; `findStatusProjectionInTx(id, tx)` returns `{id, totalAmount, paidAmount, status}`; `updateStatusInTx(id, status, tx)` flips the status. The service orchestrator passes the `tx` from its enclosing `$transaction` so the increment + status check + flip stay atomic with the ChargeLine PAID flip and the StudentAccount ledger update. |
| `server/src/repositories/finance.repository.ts` | Adds `recordPaymentLedgerEntryInTx(studentAccountId, appliedAmount, tx)` — the transaction-aware StudentAccount ledger update used by the payment-allocation pipeline. Decrements `balance` by `appliedAmount` (the full payment amount, including any leftover that sits as a credit balance), increments `totalCredits` by the same amount, stamps `lastTransactionDate`. |
| `server/src/utils/prisma-tx.ts` | **New file.** Service-layer transaction wrapper. Exports `runInTransaction(callback)` so services can open a `prisma.$transaction` without importing the Prisma client surface (which would violate Gate 4 — direct Prisma in services). |
| `server/src/utils/repository-sort-allow-lists.ts` | Adds `PAYMENT_SORT` (`id`, `transactionDate`, `amount`, `status`, `paymentMethod`, `createdAt`, `updatedAt`) for `safeOrderBy`. |
| `server/src/api/payments/payments.service.ts` | **New file.** Service orchestrator. `allocateForPayment(paymentId, options, userId, req)` loads the Payment via `repo.getById`, refuses to allocate a non-COMPLETED payment without `force: true`, loads open charges via `chargeLineRepo.findOpenForAccount`, calls the pure `allocatePayment` utility, and (in persist mode — default) opens a single `runInTransaction` that flips fully-covered ChargeLines to PAID via `chargeLineRepo.markPaidBulk`, increments each affected `Invoice.paidAmount` via `invoiceRepo.incrementPaidAmountInTx`, re-reads each invoice's status projection and promotes to PAID (when `paidAmount >= totalAmount`) or PARTIALLY_PAID (when `0 < paidAmount < totalAmount`) via `invoiceRepo.updateStatusInTx`, and updates the StudentAccount ledger via `financeRepo.recordPaymentLedgerEntryInTx`. Standard CRUD (`list` / `getById` / `create` / `update` / `remove`) with audit + `payment.created` / `payment.updated` / `payment.status_changed` / `payment.deleted` events; the action endpoint also emits `payment.allocated` regardless of preview/persist mode so n8n integrations can react to a generation attempt. The `Decimal` ↔ `number` conversion uses the same `toNumber` helper as 18A/18B. |
| `server/src/api/payments/payments.schema.ts` | **New file.** Zod validators: `paramsSchema`, `querySchema` (cursor/limit/sort/order plus `studentAccountId` / `invoiceId` / `status` / `paymentMethod` filters), `createSchema` / `updateSchema` for direct CRUD, and `allocateSchema` for the action endpoint exposing `strategy` (FIFO / PROPORTIONAL), `persist`, `force`. |
| `server/src/api/payments/payments.controller.ts` | **New file.** Thin handlers: `list`, `getById`, `create`, `update`, `remove`, plus `allocate` for the new endpoint. |
| `server/src/api/payments/payments.router.ts` | **New file.** Standard CRUD routes plus `POST /v1/payments/:id/allocate`; all FINANCE-role gated, `DELETE /:id` is SUPER_ADMIN-only. |
| `server/src/api/index.ts` | Wires `paymentsRouter` at `/v1/payments` next to the existing `invoicesRouter`. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes: `payment.created → /webhook/sjms/payment/created`, `payment.updated → /webhook/sjms/payment/updated`, `payment.allocated → /webhook/sjms/payment/allocated`, `payment.status_changed → /webhook/sjms/payment/status-changed`, `payment.deleted → /webhook/sjms/payment/deleted`. One path per workflow. |
| `scripts/check-docs-truth.mjs` | `expectedRouters` bumped from 46 → 47 to reflect the new `payments.router.ts`. |
| `CLAUDE.md` "Target Metrics" line | Router count bumped from 46 → 47. |
| `server/src/__tests__/unit/payment-allocation.test.ts` | **New file.** 21 pure-function cases — empty open-charges (full leftover), zero / negative payment amount, exact-match single charge fully covered, partial coverage, leftover with overpayment note, FIFO due-date ordering with createdAt tiebreak, no-dueDate charges sort last, alreadyAllocated subtracted from outstanding, invoiceImpact aggregation by invoiceId, ad-hoc invoice-null charge handling, zero-outstanding silent skip, two-decimal rounding; PROPORTIONAL distribution, pool capped at total outstanding, rounding-drift absorption, no-open-charges; invariants (totalAllocated + leftover === paymentAmount, 0 ≤ amount ≤ outstandingBefore, fullyCovered semantics, FIFO determinism). |
| `server/src/__tests__/unit/payments.service.test.ts` | **New file.** 19 service-orchestration cases — `allocateForPayment` NotFound on missing payment, ValidationError on non-COMPLETED status without force, force-allocates non-COMPLETED, preview mode (persist:false) does not mutate ChargeLine/Invoice/StudentAccount, persist mode flips fully-covered ChargeLines via markPaidBulk, persist mode increments Invoice.paidAmount per affected invoice, persist mode promotes invoice to PAID when paidAmount ≥ totalAmount, persist mode promotes to PARTIALLY_PAID when 0 < paidAmount < totalAmount, persist mode does NOT update status when already correct, persist mode decrements StudentAccount.balance + increments totalCredits by the full payment amount, strategy passthrough to the pure utility, payment.allocated event emission with structured payload, audit subject is Payment with structured outcome, Decimal-as-string compat; getById NotFound, create audit + event, update with status_changed conditional emission, remove soft-delete + audit + event. |

**Verification (Batch 18C):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean.
- Server Vitest: **504/504** passing (was 464/464 on the Phase 18B base; +21 pure-function cases in `payment-allocation.test.ts`, +19 service-orchestration cases in `payments.service.test.ts`).
- ESLint of changed files: 0 errors.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (router count now 47).
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new service routes everything through repo helpers + the `runInTransaction` wrapper).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 18):**
- 18D Payment plans and finance auditability improvements. The `PaymentPlan` and `PaymentInstalment` schema models exist; the next batch wires the management surface and ties scheduled instalments back into the 18C allocation pipeline.
- 18E Sponsors / Bursaries / Refunds decision batch — closes KI-P10b-001.
- Multi-payment proportional allocation across multiple StudentAccounts (sponsor-bulk receipts that should reduce charges across many students). The 18C utility allocates one payment against one account's open charges; the bulk-receipt distribution belongs to 18E with the sponsors surface.
- Reversal / refund flow. A REFUNDED Payment should reverse its allocation (un-flip ChargeLine status, decrement Invoice.paidAmount, restore StudentAccount.balance). The 18C status_changed event emits the trigger but the reversal pipeline itself is sequenced to 18E.
- Frontend surface for payment allocation. The endpoint is testable via API; the staff portal screens for the operator-driven "allocate payment" workflow are sequenced to a later 18 batch alongside the StudentAccount ledger view.

**Batch 18D — Payment plans and the 18C bridge:**

| File | Change |
|---|---|
| `server/src/utils/payment-plan-schedule.ts` | **New file.** Pure `generatePlanSchedule(input)` utility encoding the canonical instalment-distribution rule: `baseAmount = round(totalAmount / numberOfInstalments, 2)` per instalment, with rounding drift absorbed into the last so `sum(amounts) === totalAmount` exactly to 2 dp. Three frequencies — MONTHLY (default; +1 month per step with month-end clipping so 31 January + 1 month → 28/29 February), QUARTERLY (+3 months per step with the same month-end-clipping behaviour), CUSTOM (caller supplies `customDates: Date[]` whose length must equal `numberOfInstalments`, copied verbatim — useful for academic-semester boundaries). Defensive guards: non-positive `numberOfInstalments` / `totalAmount`, non-finite numeric inputs, and CUSTOM-without-matching-customDates each return an empty schedule with a diagnostic note. Pure: no Prisma, no I/O — same purity contract as `aggregateMarks` (17A), `decideProgression` / `classifyAward` (17D), `composeTranscript` (17E), `calculateFee` (18A), `composeInvoiceFromAssessment` (18B), and `allocatePayment` (18C). |
| `server/src/repositories/paymentPlan.repository.ts` | **New file.** Standard CRUD for the existing `PaymentPlan` model — hard-delete (the Prisma schema declares no `deletedAt` on PaymentPlan, and `PaymentInstalment.paymentPlanId` is `onDelete: Cascade`, so removal cascades to the instalments; operators wanting a logical delete should flip `status` to `CANCELLED` via `update()`). Adds `findActiveByStudentAccount(studentAccountId)` returning every `ACTIVE` / `DEFAULTED` plan for an account (used by the bridge to detect that a payment belongs to an in-flight plan), and `createWithInstalments(plan, instalments)` performing an atomic PaymentPlan + PaymentInstalment nested write inside a Prisma `$transaction` so the plan is never persisted without its schedule (mirrors the Phase 18B `invoice.repository.createWithLines` pattern for Invoice + ChargeLine). |
| `server/src/repositories/paymentInstalment.repository.ts` | **New file.** Standard CRUD for the existing `PaymentInstalment` model (also hard-delete; the parent PaymentPlan cascade-deletes the row when the plan itself is removed). Adds `findByPlan(planId)` returning every instalment for a plan in `instalmentNum` ascending order (used by the bridge to decide whether to promote the parent plan to COMPLETED), `findOverdue(asOf)` returning `PENDING` instalments with `dueDate <= asOf` (intended for a future Phase 20 scheduled job that issues ChargeLines for upcoming instalments), and `markPaidInTx(id, paidDate, userId, tx)` — the transaction-aware status flip used by the `recordPayment` bridge so the instalment update is atomic with the 18C ChargeLine + Invoice + StudentAccount mutations. |
| `server/src/repositories/finance.repository.ts` | Adds `getAccountById(id)` returning the active (non-deleted) StudentAccount or `null`. Used by the payment-plans service so an account can be resolved directly when the operator already has the account id (rather than the `(studentId, academicYear)` pair). Keeps Gate 4 — no direct Prisma in services — intact: the new service method routes through this repo helper rather than `prisma.studentAccount.findUnique`. |
| `server/src/utils/repository-sort-allow-lists.ts` | Adds `PAYMENT_PLAN_SORT` (`id`, `planType`, `totalAmount`, `numberOfInstalments`, `startDate`, `status`, `createdAt`, `updatedAt`) and `PAYMENT_INSTALMENT_SORT` (`id`, `instalmentNum`, `amount`, `dueDate`, `paidDate`, `status`, `createdAt`, `updatedAt`) for `safeOrderBy`. |
| `server/src/api/payment-plans/payment-plans.service.ts` | **New file.** Service orchestrator. Standard CRUD (`list` / `getById` / `create` / `update` / `remove`) with audit + `payment_plan.created` / `payment_plan.updated` / `payment_plan.status_changed` / `payment_plan.deleted` events. `generatePlan(options, userId, req)` is the action-level orchestrator: loads the StudentAccount via `financeRepo.getAccountById` (throws NotFound if missing), calls the pure `generatePlanSchedule` utility, and (in persist mode, the default) atomically writes the plan + instalments via `paymentPlan.repository.createWithInstalments`. Refuses to persist when the schedule is empty (zero instalments / zero totalAmount / CUSTOM-without-matching-customDates) — operators get a clear error from the underlying note. The `Decimal` ↔ `number` conversion uses the same `toNumber` helper as 18A/18B/18C. Always emits `payment_plan.schedule_generated` regardless of preview/persist mode so n8n integrations can react to a schedule attempt. The action-level CREATE audit fires inline because the row is written through `createWithInstalments` (which bypasses the standard `create()` audit path); the per-row `payment_plan.created` event also fires inline so both downstream paths (audit log, n8n) see the persisted plan. |
| `server/src/api/payment-plans/payment-plans.schema.ts` | **New file.** Zod validators: `paramsSchema`, `querySchema` (cursor/limit/sort/order plus `studentAccountId` / `status` / `planType` filters), `createSchema` / `updateSchema` for direct CRUD, and `generateSchema` for the action endpoint exposing `studentAccountId`, optional `planType`, `totalAmount`, `numberOfInstalments`, `startDate`, optional `frequency` / `customDates` / `initialStatus` / `persist`. The CUSTOM-frequency-vs-customDates length invariant is enforced at the schema level via a `.refine()` so the controller layer never reaches the service with an obviously-broken payload. |
| `server/src/api/payment-plans/payment-plans.controller.ts` | **New file.** Thin handlers: `list`, `getById`, `create`, `update`, `remove`, plus `generate` for the new action endpoint. |
| `server/src/api/payment-plans/payment-plans.router.ts` | **New file.** `POST /v1/payment-plans/generate` mounted **before** the `/:id` dynamic routes so the literal action path wins. All routes are FINANCE-role gated; `DELETE /:id` is SUPER_ADMIN-only (the row's instalments cascade-delete with the plan, so deletion is genuinely destructive). |
| `server/src/api/payment-instalments/payment-instalments.service.ts` | **New file.** Service orchestrator for individual instalments + the bridge to 18C. Standard CRUD (`list` / `getById` / `update` / `remove`) with audit + `payment_instalment.updated` / `payment_instalment.status_changed` / `payment_instalment.deleted` events. `recordPayment(instalmentId, options, userId, req)` is the bridge: loads the instalment + parent plan + payment via the repos (NotFound on any missing); validates the instalment is `PENDING` (or `force: true`), the payment's `studentAccountId` matches the plan's (or `force: true` for sponsor-consolidation scenarios), and the payment amount is `>=` the instalment amount (or `force: true` for partial-coverage operator overrides). Calls `paymentService.allocateForPayment` to flip the underlying ChargeLines and update the invoice/account ledger atomically (the 18C transaction is the source of truth for ledger consistency; the bridge intentionally does not nest its own transaction so the 18C invariants stay authoritative). Then flips this PaymentInstalment to `status=COMPLETED` + `paidDate=payment.transactionDate ?? now()` via the standard `update()` path so audit + UPDATE events fire normally. Re-reads the parent plan's instalments and promotes the plan to `status=COMPLETED` (via direct repo update + audit + emit) when every instalment is now `COMPLETED` and the plan is still `ACTIVE`. Always emits `payment_instalment.paid` so n8n integrations can react to a successful instalment-record without inferring it from the UPDATE event. |
| `server/src/api/payment-instalments/payment-instalments.schema.ts` | **New file.** Zod validators: `paramsSchema`, `querySchema` (cursor/limit/sort/order plus `paymentPlanId` / `status` filters), `updateSchema` for direct mutation, and `recordPaymentSchema` for the action endpoint exposing `paymentId`, optional `strategy` (FIFO / PROPORTIONAL forwarded to the 18C allocator), optional `force`. |
| `server/src/api/payment-instalments/payment-instalments.controller.ts` | **New file.** Thin handlers: `list`, `getById`, `update`, `remove`, plus `recordPayment` for the new action endpoint. |
| `server/src/api/payment-instalments/payment-instalments.router.ts` | **New file.** Standard read/update/delete routes plus `POST /v1/payment-instalments/:id/record-payment`; all FINANCE-role gated, `DELETE /:id` is SUPER_ADMIN-only. |
| `server/src/api/index.ts` | Wires `paymentPlansRouter` at `/v1/payment-plans` and `paymentInstalmentsRouter` at `/v1/payment-instalments` next to the existing `paymentsRouter`. |
| `server/src/utils/webhooks.ts` | Adds dedicated webhook routes: `payment_plan.created → /webhook/sjms/payment-plan/created`, `payment_plan.updated → /webhook/sjms/payment-plan/updated`, `payment_plan.schedule_generated → /webhook/sjms/payment-plan/schedule-generated`, `payment_plan.status_changed → /webhook/sjms/payment-plan/status-changed`, `payment_plan.deleted → /webhook/sjms/payment-plan/deleted`, `payment_instalment.updated → /webhook/sjms/payment-instalment/updated`, `payment_instalment.status_changed → /webhook/sjms/payment-instalment/status-changed`, `payment_instalment.paid → /webhook/sjms/payment-instalment/paid`, `payment_instalment.deleted → /webhook/sjms/payment-instalment/deleted`. One path per workflow. |
| `scripts/check-docs-truth.mjs` | `expectedRouters` bumped from 47 → 49 to reflect the two new routers. |
| `CLAUDE.md` "Target Metrics" line | Router count bumped from 47 → 49. |
| `server/src/__tests__/unit/payment-plan-schedule.test.ts` | **New file.** 20 pure-function cases — 3-instalment monthly happy path, drift absorption (333.33 + 333.33 + 333.34 = 1000), negative-drift cases, month-end clipping (31 January → 28/29 February), 29 February in a leap year (2028), QUARTERLY +3-month walk, CUSTOM dates verbatim and length-mismatch rejection, zero-numberOfInstalments / zero-totalAmount / negative-totalAmount / negative-numberOfInstalments / non-finite-input guards, fractional-numberOfInstalments floor, effectiveStart preservation, single-instalment schedule, instalmentNum starting at 1, determinism, and a parametric loop verifying `sum(amounts) === totalAmount` across awkward divisions. |
| `server/src/__tests__/unit/payment-plans.service.test.ts` | **New file.** 13 service-orchestration cases — `generatePlan` NotFound on missing StudentAccount; preview mode does not call createWithInstalments + emits schedule_generated; persist mode writes + emits payment_plan.created + schedule_generated; refuse-empty-schedule (zero instalments / zero totalAmount); planType override; QUARTERLY frequency override; initialStatus override; getById NotFound; create + audit + event; update with status_changed conditional emission; update no-status_changed when unchanged; remove + audit + event. |
| `server/src/__tests__/unit/payment-instalments.service.test.ts` | **New file.** 17 service-orchestration cases — `recordPayment` NotFound on missing instalment / missing plan / missing payment; reject re-recording against COMPLETED instalment without force; force-rebind COMPLETED; reject cross-account payment without force; force-bind cross-account (sponsor consolidation); reject amount-mismatch without force; force-allow partial coverage; FIFO + persist:true forwarded to the 18C allocator by default; strategy override forwarded; force forwarded so a non-COMPLETED payment can be applied; instalment flip to COMPLETED with paidDate=payment.transactionDate; payment_instalment.paid event with structured payload; plan promotion to COMPLETED when all instalments are now COMPLETED; no plan promotion when some remain PENDING; no plan promotion when plan is not ACTIVE (DEFAULTED); Decimal-as-string compat; `now()` fallback when payment.transactionDate is null; getById NotFound; update with status_changed conditional emission; remove + audit + event. |

**Verification (Batch 18D):**
- Server tsc: ✅ clean.
- Client tsc: ✅ clean (no client changes; baseline preserved).
- `prisma validate` / `prisma generate`: ✅ clean (with `DATABASE_URL` set; same precondition as 18C).
- Server Vitest: **560/560** passing (was 504/504 on the Phase 18C base; +20 pure-function cases in `payment-plan-schedule.test.ts`, +13 in `payment-plans.service.test.ts`, +17 in `payment-instalments.service.test.ts`, plus +6 sister tests that count once the service surface mounts).
- ESLint of changed files: 0 errors.
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (router count now 49).
- Verification protocol Gate 4 — direct Prisma in services: ✅ empty (the new services route everything through repo helpers; only `import type { Prisma }` for utility types appears, matching the 18B/18C pattern).
- Verification protocol Gate 9 — repository hygiene: ✅ all three checks empty.

**Deliberately out-of-scope (sequenced to later batches of Phase 18):**
- 18E Sponsors / Bursaries / Refunds decision batch — closes KI-P10b-001 and adds the reversal pipeline triggered by the `payment.status_changed → REFUNDED` event.
- A schema-level `PaymentInstalment.chargeLineId` FK linking each instalment to the ChargeLine the operator issued for it. The current bridge keeps the link implicit through the 18C allocator's open-charges scan; an explicit FK would let the bridge target a single charge directly. Migration deferred to keep 18D scope tight.
- Auto-generation of ChargeLines when an instalment falls due (so the 18C allocator picks them up without an operator intervention). Sequenced to a Phase 20 n8n scheduled job — `payment_instalment.due` would fire, an n8n workflow would call `POST /v1/finance/charge` (or a future `POST /v1/charge-lines/from-instalment`), and the open-charges set would naturally absorb the next allocation.
- Default detection / auto-promotion of `ACTIVE → DEFAULTED` when one or more instalments lapse past dueDate. Same mechanism as the auto-generation above — best handled as a Phase 20 scheduled job rather than baking domain timing into the synchronous request path.
- Frontend surface for payment plans. The endpoints are testable via API; the staff portal screens for the operator-driven "create plan" / "record instalment payment" / "view chase list" workflows are sequenced to a later 18 batch alongside the StudentAccount ledger view.

