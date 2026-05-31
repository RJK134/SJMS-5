# Phase 1F + 1G + 1I — Finance closeout bundle

> **Branch:** `phase-1f/finance-dashboards`
> **Base:** `main` at commit `b1fe6cf` (post-1E merge `feat(finance): ledger anomaly detection on BullMQ + Prometheus (Phase 1E) (#98)`).
> **Status:** draft PR — operator merges manually per operating-model §14.
> **Date:** 2026-05-31

## Scope

Three batches landed together in one PR per the operator's "auto-build all remaining phases" directive. **1H (optimistic locking) is deliberately carved out** to a separate, dedicated PR with a design-doc placeholder because the operating model §6 flags it as STOP-gate-adjacent (touches established Prisma relationships across seven race-prone models).

| Batch | Build-queue entry | Delivered as |
|---|---|---|
| 1F | Finance dashboards in staff portal (collection, ageing, sponsor liability, bursary spend). Fixes v4 `/staff/finance-overview` 404 (KI-S5-102). | `feat(finance): staff finance dashboard overview (Phase 1F)` |
| 1G | Phase closeout: BugBot, coverage ratchet +3pp, evidence pack. | This document + `server/vitest.config.ts` ratchet + docs reconciles. |
| 1I | Promote `AuditLog.userId` to FK on `User` with `onDelete: Restrict`. Closes deep-review P1 #18. | `feat(audit): promote AuditLog.userId to a structured FK on User (Phase 1I)` |
| **1H** | **Optimistic locking** for race-prone models (`Mark`, `ModuleResult`, `Invoice`, `Payment`, `ExamBoardDecision`, `AssessmentAttempt`, `Enrolment`). | **Carved out** — STOP-gate-adjacent per operating-model §6 (touches established Prisma relationships). Will ship as its own PR with a design-doc placeholder + per-model rollout. |

## 1F — Finance dashboard overview

Closes **KI-S5-102** (the v4 `/staff/finance-overview` 404).

| Layer | File | Purpose |
|---|---|---|
| Repository | `server/src/repositories/financeOverview.repository.ts` (new) | Four bounded read-only aggregators: `getCollectionTotals` (StudentAccount aggregate + per-status groupBy), `getAgeing` (open Invoice findMany bucketed CURRENT / 1–30 / 31–60 / 61–90 / 90+), `getSponsorLiability` (active SponsorAgreement groupBy sponsorType, derives `liability = agreed − received`), `getBursarySpend` (BursaryFund findMany with per-fund utilisation, NaN-safe). `getOverview()` runs them in parallel + stamps `generatedAt`. |
| Service | `server/src/api/finance/finance.service.ts` (extended) | `getOverview(asOf?)` delegates to the repository. |
| Controller | `server/src/api/finance/finance.controller.ts` (extended) | `getOverview` handler. |
| Router | `server/src/api/finance/finance.router.ts` (extended) | `GET /v1/finance/overview` mounted **before** the dynamic `/:id`. FINANCE-role gated. **No new router file** — existing finance.router.ts gains one new route. |
| UI page | `client/src/pages/finance/Overview.tsx` (new) | Four `StatCard` headlines (outstanding balance, open invoices, sponsor liability, bursary remaining); ageing strip with red 90+ / amber 61–90 highlighting; sponsor + bursary tables side-by-side; **inline 1E ledger-anomaly scan trigger** that POSTs to `/v1/ledger-anomalies/scan` and renders the structured report. Pure read — no mutation of ledger state from the UI. |
| UI routing | `client/src/pages/AdminRouter.tsx` (extended) | `<Route path="/admin/finance/overview" component={FinanceOverview} />` |

### Why a new server-side aggregation endpoint, not client-side aggregation?

Aggregating client-side from the cursor-paginated list endpoints (`GET /v1/finance`, `GET /v1/invoices`, `GET /v1/sponsor-agreements`, `GET /v1/bursary-funds`) would be slow, lossy beyond the first page, and bandwidth-hungry. The new endpoint runs four bounded Prisma `aggregate` / `groupBy` queries in parallel and returns ~1KB; the dashboard renders instantly even on a long ledger.

## 1G — Phase closeout

| Item | Action |
|---|---|
| Coverage ratchet | `server/vitest.config.ts` floors raised **35/16/33/35 → 49/24/42/49**. Current actuals on this branch: statements **52.49%**, branches **45.09%**, functions **27.84%**, lines **52.26%** — the new floors sit ~3pp under actuals, matching the Phase 17F precedent (catch regression, do not force new tests). `vitest run --coverage` exits 0. |
| Build queue header | Phase 1 row updated: 1A/1B/1B.1/1C/1D/1E merged; 1F/1G/1I in this PR; 1H carved out STOP-gated. |
| `.claude/CLAUDE.md` "Current delivery state" | Updated to reflect Phase 1 substantially complete. |
| Evidence pack | This document. |

## 1I — AuditLog FK hardening

Closes the build queue's Phase 1I batch and deep-review P1 #18.

The challenge: `audit_logs.user_id` carries values of **mixed shape** — real `User.id` strings, Keycloak `sub` claims, synthetic system actors (`system`, `system:ledger-anomaly-cron`, `system:payment-instalment-cron`), and nulls. A naive narrowing to a `userId String @relation(...)` FK would orphan every existing audit row immediately.

### Design

Additive, non-breaking, retains the historical chain:

1. **New nullable `audit_user_id` column** on `audit_logs`, FK to `users(id)` with **`ON DELETE RESTRICT`** (hard `DELETE FROM users` is blocked while audit history references the user — operators soft-delete with `User.active = false` or detach audit rows first).
2. **Index** on `audit_user_id`.
3. **Original `user_id` text preserved verbatim** — historical rows remain readable when their actor row is no longer resolvable.
4. **Audit helper resolves the actor** to a real `User.id` when possible: direct match by `User.id` (cuid), then by `User.keycloakId` (when the actor is a Keycloak `sub` claim). System actors (any `userId` starting with `system`) and nulls deliberately stay unresolved (`audit_user_id = null`). Lookup is best-effort: errors are swallowed so audit writes never fail on resolution.

### Files

| Type | Path |
|---|---|
| Schema | `prisma/schema.prisma` — `AuditLog.auditUserId` + `User.auditLogs` back-relation + `@@index([auditUserId])`. |
| Migration | `prisma/migrations/20260601000000_audit_log_user_fk/migration.sql` — additive `ALTER TABLE` / `ADD CONSTRAINT` / `CREATE INDEX`. |
| Helper | `server/src/utils/audit.ts` — `resolveAuditUserId(userId)` + populated `auditUserId` on every audit write. |
| Tests | `server/src/__tests__/unit/audit-user-fk.test.ts` — 6 cases covering the four flavours of `userId` plus User-lookup-throws and audit-write-fails paths. |

## Verification

| Gate | Result |
|---|---|
| Server tsc | ✅ exit 0 |
| Client tsc | ✅ exit 0 |
| Prisma validate | ✅ (additive change; existing data preserved) |
| Server Vitest full suite | ✅ **881 / 881 passing across 56 files** (was 864/54 on the post-1E base; +17 cases / +2 files: `finance-overview.repository.test.ts` 11, `audit-user-fk.test.ts` 6) |
| Server Vitest **with coverage** vs new 49/24/42/49 floor | ✅ Statements 52.49% · Branches 45.09% · Functions 27.84% · Lines 52.26% — all clear |
| `node scripts/check-docs-truth.mjs` | ✅ all checks pass (model count 199, router count 60) |
| `node scripts/check-undeclared-imports.mjs` | ✅ clean |
| Gate 4 — no direct Prisma in services | ✅ overview service routes through the repository; only `financeOverview.repository.ts` imports `prisma`. (Audit helper is in `utils/`, not a service — same as the existing audit helper.) |

## Phase 1 status after this PR

Substantially complete: 1A merged, 1B merged, 1B.1 merged, 1C merged, 1D merged, 1E merged, 1F here, 1G here, 1I here. **1H** (optimistic locking) remains the only outstanding Phase 1 batch — carved out for STOP-gated delivery via a separate dedicated PR + design doc.

After 1H lands, the next non-STOP-gated phase is **Phase 3** (HESA / UKVI / regulatory). Phase 2 (multi-tenancy substrate) and Phase 11 (AI-native) both stay STOP-gated.
