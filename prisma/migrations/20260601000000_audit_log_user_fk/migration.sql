-- Phase 1I — promote AuditLog.userId to a structured FK on User.
--
-- The existing `user_id` column carries values of mixed shape: User.id
-- strings, Keycloak `sub` claims, synthetic system actors ('system',
-- 'system:ledger-anomaly-cron', 'system:payment-instalment-cron'), and
-- nulls. A naive narrowing of `user_id` to a FK would break every existing
-- audit row. Instead, this migration adds a NEW nullable FK column
-- `audit_user_id` that points at `users(id)` with ON DELETE RESTRICT.
-- The application's audit helper populates it when it can resolve the
-- actor to a real User row; system actors and unresolved subs keep
-- `audit_user_id` null while the original `user_id` text is preserved.
--
-- The RESTRICT clause guarantees that the audit chain cannot be orphaned
-- by a hard `DELETE FROM users` — operators must soft-delete a user
-- (User.active = false) or explicitly detach audit rows first.

ALTER TABLE "audit_logs"
  ADD COLUMN "audit_user_id" TEXT;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_audit_user_id_fkey"
  FOREIGN KEY ("audit_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "audit_logs_audit_user_id_idx" ON "audit_logs"("audit_user_id");
