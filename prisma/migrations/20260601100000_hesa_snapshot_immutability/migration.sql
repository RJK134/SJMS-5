-- Phase 3F — HESA snapshot immutability trigger.
--
-- HESA submissions are a regulatory record. Once a snapshot row is written
-- (by the composition pipeline in `utils/hesa-return-composition.ts`), its
-- contents become the audit trail of what was submitted to HESA — they
-- must NOT be edited or deleted from the database. This trigger enforces
-- that contract at the storage layer, regardless of what the application
-- code or a direct SQL session might attempt.
--
-- Operator emergency override: if a row genuinely needs to be removed
-- (e.g. accidental test data in production), an operator with superuser
-- privileges can `SET LOCAL session_replication_role = 'replica'` for the
-- duration of a single transaction to bypass user-defined triggers, but
-- that override is itself audited via PostgreSQL's normal session logging
-- and must be justified in writing.
--
-- The trigger is BEFORE rather than AFTER so the raise is the first thing
-- the offending statement sees — no partial writes / row-version churn.

CREATE OR REPLACE FUNCTION block_hesa_snapshot_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hesa_snapshots rows are immutable — UPDATE on row id=% blocked. See Phase 3F migration for the rationale and the documented operator override.', OLD.id
      USING ERRCODE = 'restrict_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hesa_snapshots rows are immutable — DELETE on row id=% blocked. See Phase 3F migration for the rationale and the documented operator override.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER hesa_snapshots_immutability
  BEFORE UPDATE OR DELETE
  ON hesa_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION block_hesa_snapshot_mutations();

COMMENT ON FUNCTION block_hesa_snapshot_mutations() IS
  'Phase 3F — raises when any code attempts to UPDATE or DELETE a hesa_snapshots row. Override via session_replication_role=replica only with explicit operator authorisation.';
