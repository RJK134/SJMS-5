# Phase 1C — Bursary auto-decisioning

> **Branch:** `phase-1c/bursary-auto-decisioning`
> **Base:** `main` at commit `b6ca213` (post-1D merge)
> **Status:** draft PR — operator merges manually per operating-model §14
> **Date:** 2026-05-20

## Scope

Closes Batch 1C per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md) Phase 1 §1C:

> **1C.** Bursaries: `BursaryFund`, `BursaryApplication`. Auto-decisions by fund rule; manual override audited.

The `BursaryFund` + `BursaryApplication` models, repositories, and CRUD APIs already existed (carried in from the SJMS-2.5 spine). What was missing — and what this batch adds — is the rule-driven auto-decisioning surface that turns a fund's `eligibility` JSON column into a deterministic APPROVE / REJECT / REVIEW decision, atomically applies the result to the application's status + award and the fund's `allocated` / `remaining` budget, and clearly tags every status flip with its decision mode (`AUTO` vs `MANUAL`) so downstream auditors can tell them apart.

## What landed

### Pure rule engine — `server/src/utils/bursary-decision.ts` (new)

`evaluateBursaryEligibility(application, fund)` is a side-effect-free function. It reads `fund.eligibility` (an `BursaryEligibilityRules` blob) and returns `{ decision, suggestedAward, reasons, effectiveRules }`.

Decision matrix:

| Order | Condition | Outcome |
|---|---|---|
| 1 | Fund requires `circumstancesDesc` and application has none / whitespace only | `REJECT` |
| 2 | `householdIncome > autoRejectAboveIncome` | `REJECT` |
| 3 | `feeStatusAllowList` set and `application.feeStatus` not in list | `REJECT` |
| 4 | Fund has zero `remaining` and `suggestedAward > 0` | `REJECT` |
| 5 | `householdIncome ≤ autoApproveBelowIncome` and `suggestedAward > 0` | `APPROVE` |
| 6 | Otherwise | `REVIEW` |

`suggestedAward = min(defaultAwardAmount, maxAwardPerStudent, remaining)` rounded to 2 dp. Negative or non-finite rule values silently fall back to safe defaults. `effectiveRules` is returned on every call for audit replay.

Defaults (no eligibility JSON): `autoRejectAboveIncome: 60000`, `autoApproveBelowIncome: 15000`, `defaultAwardAmount: 1000`, `maxAwardPerStudent: 3000`, `requiresCircumstancesDesc: false`.

### Service orchestrator — `autoDecideForApplication` in `bursary-applications.service.ts`

Loads the application + fund, calls the pure engine, then (in persist mode, the default) applies the result inside a single `runInTransaction`:

- **APPROVE** — `reserveBudgetInTx(fund, delta)` + `updateDecisionInTx(app, { status: APPROVED, awardAmount, updatedBy })`. The delta is `suggestedAward − previousAward` so re-deciding an already-APPROVED row only mutates the difference.
- **REJECT** — when previous status was `APPROVED`, `releaseBudgetInTx(fund, previousAward)` first. Then `updateDecisionInTx(app, { status: REJECTED, awardAmount: null, updatedBy })`.
- **REVIEW** — `updateDecisionInTx(app, { status: UNDER_REVIEW, updatedBy })` only when status actually changes. No budget mutation. `awardAmount` intentionally omitted from the patch.

Terminal-state guard: `APPROVED`, `REJECTED`, `PAID` rows are not re-evaluated unless `force: true` is supplied. Preview mode (`persist: false`) runs the rule but never mutates and still emits the `auto_decided` event so n8n / observers see the trial decision.

### Manual-override tagging

The existing `update()` path now stamps `decisionMode: 'MANUAL'` on every `bursary_application.status_changed` event. The new auto-decide path stamps `decisionMode: 'AUTO'`. Downstream consumers (audit log, n8n workflows, future Phase 1F finance dashboards) can now reliably tell an operator-driven decision apart from a rule-engine-driven one without joining timestamps.

### Repository helpers

- `bursaryApplication.repository.ts::updateDecisionInTx(id, {status, awardAmount?, updatedBy?}, tx)` — transaction-aware status+award patch.
- `bursaryFund.repository.ts::reserveBudgetInTx(id, amount, tx)` — `allocated += amount`, `remaining -= amount`.
- `bursaryFund.repository.ts::releaseBudgetInTx(id, amount, tx)` — mirror of reserve.

### API surface

- `POST /v1/bursary-applications/:id/auto-decide` — FINANCE-role gated, mounted before the dynamic `/:id` routes so the literal path wins.
- Body: `{ persist?: boolean, force?: boolean, rules?: BursaryEligibilityRules }`.
- Response: `{ decision, suggestedAward, reasons, effectiveRules, applicationId, bursaryFundId, previousStatus, newStatus, persisted, budgetReserved, budgetReleased }`.

### Webhook event

- `bursary_application.auto_decided` → `/webhook/sjms/bursary-application/auto-decided`. Always fires, regardless of persist mode, so n8n integrations can capture preview decisions for ops dashboards.

### Baseline hygiene (side-effect fix)

PR #74 inadvertently reverted the Phase 0L `OutboxEvent` model + `OutboxEventStatus` enum from `prisma/schema.prisma` — even though the migration (`20260519000000_add_outbox_events`) and the worker code (`utils/outbox.ts`, `utils/outbox-dispatch.ts`, `workers/outbox.worker.ts`) all remained. The result: `npx tsc --noEmit` was failing on `main` with 6 errors referencing `outboxEvent`/`OutboxEvent`. Restored both declarations to the schema verbatim from the original Phase 0L commit (`f6a3ce3`). Also fixed a pre-existing JSON parse error in `server/package.json` (duplicate `test:coverage` script line) that was blocking `vitest run` on `main`.

`expectedModels` in `scripts/check-docs-truth.mjs` bumped from `196` → `199` (1B Sponsor + SponsorInvoice already on `main` at +2, plus the restored `OutboxEvent` model = +3).

## Files

| Type | Path |
|---|---|
| Pure utility | `server/src/utils/bursary-decision.ts` (new) |
| Repository | `server/src/repositories/bursaryApplication.repository.ts` (+ `updateDecisionInTx`) |
| Repository | `server/src/repositories/bursaryFund.repository.ts` (+ `reserveBudgetInTx`, `releaseBudgetInTx`) |
| Service | `server/src/api/bursary-applications/bursary-applications.service.ts` (+ `autoDecideForApplication`, MANUAL tag on update path) |
| Schema | `server/src/api/bursary-applications/bursary-applications.schema.ts` (+ `autoDecideSchema`) |
| Controller | `server/src/api/bursary-applications/bursary-applications.controller.ts` (+ `autoDecide` handler) |
| Router | `server/src/api/bursary-applications/bursary-applications.router.ts` (+ `POST /:id/auto-decide`) |
| Wiring | `server/src/utils/webhooks.ts` (+ `bursary_application.auto_decided` route) |
| Tests | `server/src/__tests__/unit/bursary-decision.test.ts` (new, 15 cases) |
| Tests | `server/src/__tests__/unit/bursary-applications.service.test.ts` (+11 cases: 10 autoDecide + 1 MANUAL tag) |
| Baseline | `prisma/schema.prisma` (restored `OutboxEvent` + `OutboxEventStatus`) |
| Baseline | `server/package.json` (deduped `test:coverage` script line) |
| Docs | `scripts/check-docs-truth.mjs` (`expectedModels` 196 → 199) |
| Docs | `CLAUDE.md` Target Metrics (196 models → 199, 57 routers → 59) |

## Verification

- Server tsc: ✅ exit 0
- Prisma validate: ✅ schema valid
- Server Vitest full suite: ✅ **831 / 831 passing across 51 files** (+26 new cases over Phase 1D's baseline)
- New tests in isolation: 36 / 36 (15 pure rule + 21 service orchestrator)
- `node scripts/check-docs-truth.mjs`: ✅ all checks pass (199 models, 59 routers)
- Gate 4 — no direct `prisma.*` in services: ✅ `autoDecideForApplication` routes through `runInTransaction` + repo helpers
- Gate 9 — hygiene: ✅ no `.claude/worktrees/`, no stray `*.txt`

## Out of scope (sequenced to later batches)

- **`bursary_application.auto_decided` n8n workflow.** Webhook route is registered; the actual n8n workflow that consumes it is a Phase 8 n8n-activation concern.
- **Application `feeStatus` resolution from the enrolment context.** The pure engine accepts a `feeStatus` allow-list and the service intentionally passes `null` for now — once Phase 1F finance dashboards join the bursary surface to the student/enrolment context, the service can pass the resolved `feeStatus`.
- **Bulk auto-decide endpoint** (`POST /v1/bursary-funds/:id/auto-decide-pending` style cohort sweep). Single-row decisioning is the primitive; cohort sweeping belongs to the same Phase 1E ledger-audit work that drives the BullMQ anomaly detector.
- **Auto-PAID transition** when finance disburses a bursary against the fee assessment. Today `PAID` is reachable only via the manual `update()` path; wiring the auto-transition belongs to a future fee-disbursement batch.
- **Coverage ratchet** (+3pp closeout). Belongs to Phase 1G after 1E + 1F land.
