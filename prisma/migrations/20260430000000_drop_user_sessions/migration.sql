-- Drop the dormant user_sessions table.
--
-- Why: Authentication in SJMS 2.5 is Keycloak OIDC; sessions live in
-- the IdP, not in this database. The user_sessions table was residue
-- from an earlier design and was never read or written by the
-- application (verified zero references across server/src and
-- client/src on 2026-04-29; see evidence/secrets-at-rest-2026-04-29.json).
-- Dropping the table removes a phantom plaintext-at-rest secret store
-- and the matching `UserSession` model from prisma/schema.prisma.
-- Authorised under Option D of docs/security/secrets-at-rest.md by
-- @RJK134 on 2026-04-30.
--
-- The migration is idempotent (IF EXISTS guards) so it is safe to
-- re-run against environments where the table has already been
-- removed (e.g. fresh installs from this point on, where the baseline
-- migration runs first and would have created the table; this
-- migration then drops it).
--
-- Reversibility: a reverse migration would have to re-create the
-- table with the shape captured in the baseline migration. The
-- definition is preserved here as a comment for that purpose:
--
--   CREATE TABLE "user_sessions" (
--       "id" TEXT NOT NULL,
--       "user_id" TEXT NOT NULL,
--       "session_token" TEXT NOT NULL,
--       "ip_address" TEXT,
--       "user_agent" TEXT,
--       "login_at" TIMESTAMP(3) NOT NULL,
--       "last_active_at" TIMESTAMP(3) NOT NULL,
--       "logout_at" TIMESTAMP(3),
--       "is_active" BOOLEAN NOT NULL DEFAULT true,
--       "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--       "updated_at" TIMESTAMP(3) NOT NULL,
--       "created_by" TEXT,
--       "updated_by" TEXT,
--       CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
--   );
--   CREATE UNIQUE INDEX "user_sessions_session_token_key" ON "user_sessions"("session_token");
--   CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
--   CREATE INDEX "user_sessions_is_active_idx" ON "user_sessions"("is_active");
--   ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
--       FOREIGN KEY ("user_id") REFERENCES "users"("id")
--       ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the foreign-key constraint first so the DROP TABLE does not
-- block on it. Idempotent.
ALTER TABLE IF EXISTS "user_sessions" DROP CONSTRAINT IF EXISTS "user_sessions_user_id_fkey";

-- Drop the indexes. Idempotent.
DROP INDEX IF EXISTS "user_sessions_session_token_key";
DROP INDEX IF EXISTS "user_sessions_user_id_idx";
DROP INDEX IF EXISTS "user_sessions_is_active_idx";

-- Drop the table. Idempotent.
DROP TABLE IF EXISTS "user_sessions";
