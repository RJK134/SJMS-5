# Phase 0 — batch 0B finance absorption verification

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under verification:** `phase-0/spine-import` at HEAD `167d9adecb51b43b4531b6f0aeb7938399b4b173` (commit "phase-0a2: surgical rebrand SJMS-2.5 → SJMS-5", PR #38)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0B:

> Import SJMS-2.5 `claude/phase-18b-invoice-generation` and `claude/phase-18c-payment-allocation` as Phase 0 sub-commits. Acceptance: invoice + payment-allocation tests green (~504 tests).

## Finding — 18B + 18C are already in the spine via 0A1

When the [`phase-0a-bootstrap-spine.yml`](../../.github/workflows/phase-0a-bootstrap-spine.yml) workflow ran (commit `7d0c6acc` on this branch), it took SJMS-2.5 `main` at HEAD `83e5a169f87705e86f97032156f69042c9ae220d` (timestamp 2026-05-16 01:45 +0200). By that point both `claude/phase-18b-invoice-generation` and `claude/phase-18c-payment-allocation` had already merged into SJMS-2.5 `main` — so the bootstrap absorbed the full 18B + 18C diff as part of the spine.

A planned separate-commit absorption (the wording of batch 0B) is therefore unnecessary and would land an empty diff. 0B becomes a **verification batch** evidencing the absorption.

### Diff between bootstrap baseline and current SJMS-2.5 main

`git diff --stat 83e5a169..cb3a75b6` against `RJK134/SJMS-2.5` returns:

| File | +/− |
|---|---:|
| `client/package.json` | 16 |
| `package-lock.json` | 691 |
| `package.json` | 2 |
| `server/package.json` | 12 |
| **Total** | **4 files / 721 lines** |

Filtering the file list to `finance|invoice|payment|fee|charge|bursary|sponsor|refund` returns zero files. Nothing finance-related has changed in SJMS-2.5 between bootstrap baseline and current main — confirming the spine already carries the canonical 18B + 18C work.

## Finance scaffolding present in `phase-0/spine-import`

### Prisma models (`prisma/schema.prisma`)

```
model ChargeLine        {…}
model CreditNote        {…}
model FeeAssessment     {…}
model Invoice           {…}
model Payment           {…}
model PaymentInstalment {…}
model PaymentPlan       {…}
model StudentAccount    {…}
```

All eight finance ledger models from SJMS-2.5 Phase 17/18 work are present.

### Finance utility modules (`server/src/utils/`)

```
fee-calculation.ts
invoice-composition.ts
payment-allocation.ts
payment-plan-schedule.ts
```

All four utility modules from 18A + 18B + 18C + (18D scaffold) are present.

### Finance API routers (`server/src/api/`)

```
bursary-applications/
bursary-funds/
credit-notes/
fee-assessments/
finance/
invoices/
payment-instalments/
payment-plans/
payments/
refund-approvals/
sponsor-agreements/
```

Eleven finance-related routers are present (note: bursary, refund, and sponsor folders are scaffolded but their full business logic is sequenced to Phase 1 batches 1B / 1C / 1D per [`SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-1--finance-closeout-expanded) — Phase 0 inherits the scaffolds only).

## Acceptance — test results

### Finance unit tests

Run command: `cd server && npx vitest run src/__tests__/unit/{payment-plans.service,payment-allocation,invoices.service,invoice-composition,payments.service,fee-calculation,payment-instalments.service,fee-assessments.service}.test.ts`

```
 Test Files  8 passed (8)
      Tests  175 passed (175)
```

### Full server Vitest suite

Run command: `cd server && npx vitest run`

```
 Test Files  42 passed (42)
      Tests  707 passed (707)
   Duration  3.57s
```

707 / 42 comfortably exceeds the ~504-test guidance in the build-queue acceptance line, reflecting that the imported spine carried subsequent SJMS-2.5 test additions (Phases 17D/E/F + 18A coverage ratchet) alongside 18B and 18C.

### Prisma schema

Run command: `DATABASE_URL=… DIRECT_URL=… npx prisma validate`

```
Prisma schema loaded from prisma/schema.prisma
The schema at prisma/schema.prisma is valid 🚀
```

(One advisory warning: `package.json#prisma` deprecated in favour of `prisma.config.ts` — tracked as drive-by hygiene under batch 0I.)

### Server TypeScript

Run command: `cd server && npx tsc --noEmit`

Exit code 0. No diagnostics.

## Verdict

**Batch 0B: done.** No source code change required. This evidence file documents the absorption that landed mechanically inside 0A1.

## Follow-on items

- Batch 1A (Phase 1) will own the **PaymentPlan instalment generator cron** and the optimistic-locking pass that 18D specified but is out of scope for Phase 0 per the synthesis plan.
- Phase 1 batches 1B / 1C / 1D own the **Sponsors, Bursaries, Refunds** business logic against the existing scaffolded routers.
- The deprecated `package.json#prisma` configuration is a drive-by candidate for 0I (CI green).
