# Batch 1H — Optimistic locking on 7 race-prone models

> **Captured:** 2026-05-19
> **Companion to:** [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md) Phase 1 row 1H.
> **Closes:** deep-review P1 #17 (prompt I).

## What this PR adds

A reusable optimistic-locking primitive plus the schema groundwork on seven models that the deep review flagged as race-prone.

| File | Role |
|---|---|
| `prisma/schema.prisma` | Adds `version Int @default(1)` to `Application`, `Enrolment`, `AssessmentAttempt`, `ModuleResult`, `ExamBoardDecision`, `Invoice`, `Payment`. |
| `prisma/migrations/20260519010000_add_version_for_optimistic_locking/migration.sql` | `ALTER TABLE ... ADD COLUMN version INTEGER NOT NULL DEFAULT 1` for each. |
| `server/src/utils/errors.ts` | Adds `OptimisticLockError` (HTTP 409, code `OPTIMISTIC_LOCK_CONFLICT`). Carries `entityType`, `entityId`, `expectedVersion`. |
| `server/src/utils/optimistic-lock.ts` | `updateWithVersion(delegate, entityType, id, expectedVersion, data)` helper. One-liner for repositories: runs `UPDATE WHERE id = ? AND version = ?` via Prisma's `updateMany`, increments `version` atomically on success, throws `OptimisticLockError` if no row matched. |
| `server/src/__tests__/unit/optimistic-lock.test.ts` | 10 tests — commit-on-match, throw-on-mismatch, error shape, soft-delete handling, data preservation. |

## Model substitution

The deep review's list was `Mark / ModuleResult / Invoice / Payment / ExamBoardDecision / AssessmentAttempt / Enrolment`. There is no `Mark` model in the schema — marks live as fields on `AssessmentAttempt` (`rawMark`, `moderatedMark`, `finalMark`) and as append-only `MarkEntry` audit rows. Optimistic locking on `MarkEntry` adds no value because the row is never updated; locking the `AssessmentAttempt` (already in the list) is the load-bearing place.

The 7th slot is therefore filled by **`Application`**. Admissions has a heavy state machine (Batch 16A) that's a natural concurrency hotspot — multiple admissions officers can edit the same application before one of them commits a status transition. Documented here so future operators understand the substitution.

## Pattern

```typescript
// 1. Read the row (a GET handler returns the version to the client).
const invoice = await invoiceRepo.getById(id);
return { ...invoice }; // payload includes `version`

// 2. Client edits, then submits the version it observed.
PATCH /v1/invoices/:id
{ "version": 4, "status": "PAID", "paidAmount": "100.00" }

// 3. Repository routes through the helper:
return updateWithVersion(
  prisma.invoice,
  "Invoice",
  id,
  expectedVersion,
  { status, paidAmount },
);

// 4. If another process committed first, the helper throws
//    OptimisticLockError → HTTP 409. Client refetches + retries.
```

## Why optimistic, not pessimistic

- **No long-held DB locks.** `SELECT FOR UPDATE` holds a row lock across the user-think-time window — pathological if the operator leaves the dialog open for an hour. Optimistic locking releases the DB immediately.
- **Stateless / HTTP-friendly.** The client carries the version in the payload; no server-side session state required.
- **Cheap.** One integer column + an indexed `WHERE`. The same column also serves as the audit trail for "how many times has this row been edited".

## What this PR does NOT do

- **Migrate every service method.** Each of the seven models has a CRUD service that calls `repo.update()` today. Enrolling each method in optimistic locking is a per-method change: the service layer needs to accept `expectedVersion` in its input schema, validate it, and route through `repo.updateWithVersion()`. Sequenced as **KI-S5-1H-2** — a mechanical sweep, one service per PR (7 PRs total).
- **Surface the version in OpenAPI / TypeScript types.** The Prisma client regen will include it automatically; the OpenAPI schemas need a manual touch. Picked up in the per-service migration.
- **Wire the 409 → HTTP body convention.** The existing global error handler in `server/src/middleware/error-handler.ts` already serialises `AppError`s including the structured `code`, so `OPTIMISTIC_LOCK_CONFLICT` flows through to the client correctly. No middleware change needed.
- **Increment version on backfill / migration scripts.** Scripts that bypass the service layer must remember to set version manually or use `updateWithVersion`. Documented in `docs/standards/coding-standards.md` (follow-on).

## Verification

```
$ pnpm exec vitest run src/__tests__/unit/optimistic-lock.test.ts
✓ src/__tests__/unit/optimistic-lock.test.ts (10 tests) 35ms

Test Files  1 passed (1)
     Tests  10 passed (10)
```

```
$ DATABASE_URL=... DIRECT_URL=... npx prisma validate
The schema at prisma/schema.prisma is valid 🚀
```

Coverage of the helper's three branches (matched, not-matched, soft-delete off) is exhaustive.

## Acceptance signal

Closes deep-review P1 #17. The primitive is in place; per-service migration tracked as KI-S5-1H-2. Future batches that add new race-prone models drop in `version Int @default(1)` and route their service-update path through `updateWithVersion()` for free.
