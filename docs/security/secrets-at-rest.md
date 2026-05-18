# Secrets at rest — design decisions

> **Status (UserSession):** RESOLVED 2026-04-30 — Option D / C accepted.
> The `UserSession` model and `user_sessions` table are dropped in
> `prisma/migrations/20260430000000_drop_user_sessions/migration.sql`.
> See `evidence/secrets-at-rest-decision-2026-04-30.json`.
>
> **Status (WebhookSubscription.secretKey):** OPEN. The choice between
> Option B (wire `secretKey` into the HMAC signer first, then encrypt
> at rest) and Option C (drop the dormant `secretKey` column) is still
> a product decision that hinges on whether per-subscription HMAC is
> wanted by downstream subscribers (n8n today, partner systems
> tomorrow). The next blocker run picks up only once that question
> is answered.
>
> **Evidence records:**
> - `evidence/secrets-at-rest-2026-04-29.json` — original mismatch findings
> - `evidence/secrets-at-rest-decision-2026-04-30.json` — UserSession resolution
>
> **Source prompt:** Future Horizons blocker prompt
> `secrets-at-rest-encryption` (`fh-blocker-prompt-v1`).
> **Last updated:** 2026-04-30

The prompt asks for envelope encryption of two columns it identifies
as live, plaintext-at-rest secrets:

- `WebhookSubscription.secretKey` — said to sign outbound webhooks.
- `UserSession.sessionToken` — said to validate active sessions.

Verification against the actual repository found that **both columns
are dormant**: stored on the row but never read by the application.
Encrypting data nothing reads is a category error — it adds
operational complexity (KEK provisioning, rotation tooling,
fail-closed startup checks) without protecting any live data. The
right action depends on a human product decision the prompt cannot
make, so this branch stops here and asks for direction.

The full mismatch evidence is in
`evidence/secrets-at-rest-2026-04-29.json`. The summary:

| Column                              | Stored? | Read by application? | Risk today |
| ----------------------------------- | ------- | -------------------- | ---------- |
| `WebhookSubscription.secret_key`    | yes     | **no**               | Plaintext-at-rest of a value the API accepts and stores but never uses. Risk = exposure of a secret an attacker could have set themselves on a row they own. Limited live impact. |
| `UserSession.session_token`         | yes     | **no**               | Plaintext-at-rest of a column never written by any app code. Risk = the column shape suggests sessions live in this database when they live in Keycloak. Live impact = effectively zero. |

The signer at `server/src/utils/webhooks.ts:124` uses the env-vared
`WEBHOOK_SECRET`, not `WebhookSubscription.secretKey`. Auth lives in
Keycloak, not in `UserSession`. The columns are residue from earlier
designs.

## What the prompt asked for, adapted to Prisma

If the design decision lands on "execute the prompt as written", the
adapted plan looks like this:

1. New helper `server/src/utils/crypto.ts` with `encryptSecret(plaintext, context)` and `decryptSecret(record, context)` using AES-256-GCM, AAD bound to `<table>:<rowId>`, and a key-version dispatch loaded from `SECRET_ENCRYPTION_KEYS` (JSON map `{"1":"…","2":"…"}`). Server refuses to start in production if the env is missing or an active key is shorter than 32 bytes.
2. Prisma schema additions on each of `WebhookSubscription` and `UserSession`:
   - `secretKeyCiphertext   Bytes?    @map("secret_key_ciphertext")`
   - `secretKeyIv            Bytes?    @map("secret_key_iv")`
   - `secretKeyTag           Bytes?    @map("secret_key_tag")`
   - `secretKeyAlg           String?   @map("secret_key_alg")`
   - `secretKeyVersion       Int?      @map("secret_key_key_version")`
   - rename of the legacy column to `legacySecretKeyPlaintext` / `legacySessionTokenPlaintext` so any accidental read is loud.
3. Two additive migrations under `prisma/migrations/<ts>_encrypt_<table>_secrets/migration.sql` that add the new columns alongside the renamed legacy column. Idempotent (`IF NOT EXISTS`).
4. A backfill migration that reads each non-null legacy plaintext, encrypts via the helper, writes the ciphertext columns, and nulls the legacy column. Re-runnable. Expired sessions are deleted rather than encrypted.
5. Dual-read code path in the relevant service / repository: write encrypted, read encrypted-or-legacy (with a structured warn log on the legacy path that contains the row id and the literal string `<encrypted>` only).
6. Rotation tool at `scripts/security/rotate-secrets.ts` that decrypts with the old key version and re-encrypts with the current. Runnable in batches.
7. A separate destructive PR after a 7-day bake that drops `legacySecretKeyPlaintext` / `legacySessionTokenPlaintext`.
8. Tests: round-trip, AAD mismatch, key-version dispatch, migration replay against a disposable Postgres in CI, webhook-signing identity pre/post, session-validation identity pre/post.
9. New required CI job `secrets-encryption-verify`.

This is roughly 600–800 LOC of meaningful code (excluding the
migration SQL). It does not protect any live data today.

## Four options, each maps to a follow-on PR

### Option A — Encrypt as-is (the prompt taken literally)

Execute the adapted plan above for both columns. Keeps both columns
alive, encrypted, with rotation tooling.

**Acceptance criteria:**

- `secrets-encryption-verify` CI job green
- `SECRET_ENCRYPTION_KEYS` documented in `.env.example` with a
  fail-closed startup check
- Round-trip and AAD-bind unit tests pass
- Backfill migration is idempotent and reversible until the legacy
  column drop
- Webhook signing produces identical HMAC pre/post (uses
  `WEBHOOK_SECRET`, so encryption-at-rest of `secretKey` does not
  change the wire signature)
- Session validation behaviour unchanged (column is unused, so the
  test is asserting that the migration did not regress an unrelated
  path)

**Why we do not recommend this.** Adds a production fail-closed env
requirement, a rotation runbook, and a CI gate to protect data the
application does not currently read. The hard guardrail #6
(fail closed) interacts badly with this option — production
deployments will start to depend on `SECRET_ENCRYPTION_KEYS` being
provisioned, but the dependency would protect zero live data.

### Option B — Wire `secretKey` into the HMAC signer, then encrypt

Make per-subscription HMAC a real feature on the webhook side:

1. Update `server/src/utils/webhooks.ts::signPayload` to take an
   optional `secret` argument; when the dispatched payload's
   subscription has a non-null `secretKey`, sign with that key
   instead of `WEBHOOK_SECRET`.
2. Document the per-subscription override in `SECURITY.md` and in
   the API surface so subscribers can register a key, verify the
   signature with that key, and rotate independently of the
   global env secret.
3. Once `secretKey` has live read traffic, encrypt at rest exactly
   as Option A describes — but only for the `WebhookSubscription`
   side. The `UserSession` decision lands separately (Option C).

**Acceptance criteria:**

- Same as Option A for crypto, plus:
- Webhook signing test produces correct HMAC against the per-row
  key, falling back to `WEBHOOK_SECRET` when the row has no key
- The receiving end (n8n workflows in `server/src/workflows/`) is
  audited to confirm whether per-subscription verification is
  even consumable today

**Open question for the human reviewer:** is per-subscription HMAC
actually wanted? If subscribers (n8n today, partner systems
tomorrow) all verify with the global `WEBHOOK_SECRET`, Option B
buys nothing over Option C and adds maintenance.

### Option C — Drop the dormant columns and the dormant model

Stop storing the secrets. Reduce the at-rest risk to zero by
removing the at-rest data.

1. Remove `secretKey` from `server/src/api/webhooks/webhooks.schema.ts`
   (Zod create / update). Add a deprecation notice to the API doc.
2. Add a Prisma migration that drops `secret_key` from
   `webhook_subscriptions`. Reversible (`down` re-adds the column
   nullable).
3. Add a Prisma migration that drops the `user_sessions` table and
   removes the `UserSession` model from `prisma/schema.prisma`.
   Reversible (`down` recreates the table from the baseline migration).
4. Add a regression test that confirms creating a webhook
   subscription no longer requires `secretKey`.

**Acceptance criteria:**

- `prisma migrate deploy` against a disposable Postgres in CI passes
  for both forward and reverse paths
- The Webhooks API rejects requests that include `secretKey` (or
  silently strips it, depending on backwards-compat decision)
- No regressions in the existing webhooks unit / integration tests
- The drop of `user_sessions` is gated by a 7-day bake under
  observability ("nobody read this in 7 days") before the migration
  is shipped

**Why we recommend this for `UserSession`.** The model is genuinely
inert: zero references in `server/src`, auth lives in Keycloak.
Dropping it cleans up the schema and removes a phantom secret store
without changing any live behaviour.

### Option D — Hybrid (recommended)

Drop `user_sessions` outright (Option C for the session side). For
webhooks, choose Option B if per-subscription HMAC is wanted, else
Option C.

**Acceptance criteria:** the union of the chosen sub-options.

## Decisions

### 1. `UserSession` — RESOLVED 2026-04-30

**Decision:** drop (Option D / Option C for the session side).
**Recorded by:** @RJK134 in the next-stage instruction following PR
#158's merge.
**Implementation:** branch `claude/blocker-secrets-at-rest-drop-user-sessions`,
which:

- Removes `model UserSession` from `prisma/schema.prisma`.
- Removes the `sessions UserSession[]` relation from `model User`.
- Adds migration `prisma/migrations/20260430000000_drop_user_sessions/migration.sql`
  which drops the foreign-key constraint, the three indexes
  (`session_token_key`, `user_id_idx`, `is_active_idx`), and the
  `user_sessions` table itself. Each step is `IF EXISTS`-guarded
  so the migration is idempotent.
- Updates the canonical model count from 197 → 196 in
  `CLAUDE.md`, `README.md`, `docs/phase-status.json`, and the
  `expectedModels` constant in `scripts/check-docs-truth.mjs`.

The pre-merge bake the original Option D recommendation called for
("nobody read this in 7 days, gated by observability") is replaced
by the existing static evidence: zero references to `sessionToken`,
`session_token`, or `UserSession` across `server/src` and
`client/src` on 2026-04-29 (recorded in
`evidence/secrets-at-rest-2026-04-29.json::mismatches[2]`). No
read path means no production traffic to bake away.

The migration is forward-only-with-reversal-comment: the original
table shape is preserved as a SQL comment in the migration file so a
reverse migration can be authored if ever needed.

### 2. `WebhookSubscription.secretKey` — STILL OPEN

The choice between Option B (wire `secretKey` into the HMAC signer
first, then encrypt at rest) and Option C (drop the dormant column
outright) is a product decision about whether per-subscription HMAC
is wanted by downstream subscribers. The evidence does not pre-empt
the choice. This decision must be recorded before the next blocker
run can pick it up.

If the answer is **Option B** (wire into signer):

1. Update `server/src/utils/webhooks.ts::signPayload` to accept an
   optional per-row secret and prefer it over `WEBHOOK_SECRET`.
2. Verify n8n workflow consumers can verify with the per-row key.
3. Encrypt `secretKey` at rest with envelope encryption (the
   adapted Prisma plan in this document's "What the prompt asked
   for" section).
4. Document key-rotation procedure for subscribers.

If the answer is **Option C** (drop the column):

1. Remove `secretKey` from `server/src/api/webhooks/webhooks.schema.ts`
   (Zod create / update).
2. Add a Prisma migration that drops `secret_key` from
   `webhook_subscriptions`.
3. Document the API change as a deprecation in `SECURITY.md`.
4. No encryption helper, no KEK env var, no rotation runbook.

Recommendation default: **Option C** unless per-subscription HMAC
is actively wanted. The repo currently does not consume
`secretKey` from a stored row, so adding the signing wiring is net
new feature work that should be scoped on its own product brief
rather than bolted onto a security remediation.

## Cross-references

- `evidence/secrets-at-rest-2026-04-29.json` — original mismatch
  findings (historical baseline).
- `evidence/secrets-at-rest-decision-2026-04-30.json` — UserSession
  resolution record.
- `prisma/migrations/20260430000000_drop_user_sessions/migration.sql`
  — the drop migration with the original table shape preserved
  as a comment for reversibility.
- `prisma/schema.prisma` line ~4818 (`WebhookSubscription`) — the
  remaining dormant column awaiting decision.
- `server/src/utils/webhooks.ts` lines 34, 124 — the live HMAC
  signer keyed off `WEBHOOK_SECRET` (env), not the column.
- `server/src/middleware/auth.ts` — the live auth path; never read
  `UserSession` (and now cannot, since the model is gone).
- `CLAUDE.md` — confirms `Auth | Keycloak 24 (OIDC, 36 roles)`.
- `GOVERNANCE.md` §9 — AI agents must STOP on architectural
  mismatch and surface to a human before code changes; this
  document is that surface.
