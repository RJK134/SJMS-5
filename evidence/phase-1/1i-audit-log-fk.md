# Batch 1I — AuditLog FK hardening

> **Captured:** 2026-05-19
> **Companion to:** [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md) Phase 1 row 1I.
> **Closes:** deep-review P1 #18.

## Problem

`AuditLog.userId` was a free-text `String?` column. Three load-bearing consequences:

1. **Compliance risk.** A typo or stale reference produced a "userId" that pointed to nobody. No SQL constraint detected it. Investigators chasing "who did what" hit dead ends.
2. **Orphan-able.** A hard-delete of a User row left every AuditLog entry for that user with a dangling reference. No `ON DELETE` policy applied — the database silently let the audit chain break.
3. **No relational queries.** Joining audit history to current user attributes (`User.firstName`, `User.email`) required a manual `WHERE user_id = ?` lookup. Prisma couldn't generate a typed relation include.

## What 1I changes

| File | Change |
|---|---|
| `prisma/schema.prisma` (AuditLog) | Adds `user User? @relation(fields: [userId], references: [id], onDelete: Restrict)`. The scalar `userId` stays nullable to accommodate automated-job events. |
| `prisma/schema.prisma` (User) | Adds the inverse `auditLogs AuditLog[]` relation. Documented in a comment that hard-delete is blocked by Restrict; soft-deactivate via `User.active = false`. |
| `prisma/migrations/20260519020000_audit_log_user_fk/migration.sql` | Two steps: (1) NULL orphaned `audit_logs.user_id` values that don't match any current `users.id` so the FK constraint can be applied; (2) `ADD CONSTRAINT ... FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE`. |

## Why `Restrict` rather than `SetNull` or `Cascade`

| Policy | Behaviour | Why not |
|---|---|---|
| `ON DELETE Cascade` | Deleting a user also deletes their audit log entries. | Defeats the purpose. The audit log exists to outlive the user. |
| `ON DELETE SetNull` | Deleting a user leaves audit rows with `user_id = NULL`. | The audit trail loses provenance — investigators can't tell "did Alice do this, or Bob who was later deleted?". |
| `ON DELETE Restrict` (chosen) | Deleting a user is **refused** by the DB while audit rows exist. | The DB enforces "you cannot lose audit history by deleting a user". Operators who need to deactivate a user set `User.active = false` instead. |
| `ON DELETE NoAction` | Same effective behaviour as Restrict in Postgres, but evaluated at end-of-transaction. | Restrict is more eager and gives cleaner error messages. |

## Pre-migration hygiene

The migration's first statement NULLs out orphaned `user_id` values:

```sql
UPDATE audit_logs SET user_id = NULL
 WHERE user_id IS NOT NULL
   AND user_id NOT IN (SELECT id FROM users);
```

This protects historical events authored by automated imports (no User row) or by users that were hard-deleted before this policy existed. After the migration:

```sql
-- Count of nulled rows for audit:
SELECT COUNT(*) FROM audit_logs
 WHERE user_id IS NULL AND timestamp < '2026-05-19';
```

The result is the number of legacy "actor-unknown" events. Operators can review and decide whether to reconstruct the actor (from `userRole` + `ipAddress` + `userAgent` columns) or leave NULL.

## What 1I does NOT do

- **Make `userId` non-nullable.** Some legacy events were authored by automated jobs and there's no User row to point at. The deep review's recommendation was the FK + Restrict policy; full non-nullability requires a separate migration after the legacy backfill is decided.
- **Add a `system` virtual User row.** A future PR (`KI-S5-1I-2`) can introduce one for automated jobs so the FK is always populated. Out of scope for this PR.
- **Migrate audit-writer call sites.** The existing `audit()` helper in `server/src/utils/audit.ts` already writes the userId as-is. No code changes needed; the FK constraint catches mistakes at the DB layer.

## Verification

```
$ DATABASE_URL=... DIRECT_URL=... npx prisma validate
The schema at prisma/schema.prisma is valid 🚀
```

The migration SQL is hand-verified against Prisma 6.19's emitter convention. Round-trip test against a real Postgres belongs to Phase 0I's CI baseline.

## Acceptance signal

Closes deep-review P1 #18. The audit chain is now DB-enforced: no user can be hard-deleted without explicit reconciliation of their audit history, and every audit row points to a real User (or `NULL` for system events).
