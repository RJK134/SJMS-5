-- Batch 1H — optimistic-locking version columns.
-- Adds version INTEGER NOT NULL DEFAULT 1 to 7 race-prone models.
-- Repository update helpers (server/src/utils/optimistic-lock.ts) check
-- the expected version on every UPDATE and throw OptimisticLockError
-- (HTTP 409) on mismatch; version increments atomically on success.

ALTER TABLE "applications"          ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "enrolments"            ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "assessment_attempts"   ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "module_results"        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "exam_board_decisions"  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "invoices"              ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "payments"              ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
