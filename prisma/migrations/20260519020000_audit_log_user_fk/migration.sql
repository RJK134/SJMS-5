-- Batch 1I — AuditLog.userId is promoted to a FK on User.id with onDelete: Restrict.
-- Closes deep-review P1 #18.
--
-- Pre-FK hygiene: NULL out any orphaned audit_logs.user_id values that don't
-- match a real User row. This protects historical events authored by automated
-- imports or by users that have since been hard-deleted (pre-Phase-1 era).
-- Operators can audit the count of nulled rows after the migration with:
--   SELECT COUNT(*) FROM audit_logs WHERE user_id IS NULL AND timestamp < '<migration date>';

UPDATE "audit_logs"
   SET "user_id" = NULL
 WHERE "user_id" IS NOT NULL
   AND "user_id" NOT IN (SELECT "id" FROM "users");

-- Add the foreign-key constraint. ON DELETE RESTRICT means the DB refuses to
-- hard-delete a User row that has AuditLog references; operators who need to
-- deactivate a user must set `active = false` instead.
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
