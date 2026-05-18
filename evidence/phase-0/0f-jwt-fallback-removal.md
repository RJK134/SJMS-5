# Phase 0 — batch 0F static-secret JWT fallback removal

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under change:** `phase-0f/jwt-fallback-removal` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0F:

> Remove the static-secret JWT fallback from `auth.ts` production code path (closes 2.5 Phase 15B primary STOP-gate **and** deep-review P0 #7). Acceptance: env audit shows zero fallback uses; JWT verification fails closed on Keycloak unavailable.

## The bug

`server/src/middleware/auth.ts` shipped with a two-mode `verifyToken`:

```ts
async function verifyToken(tokenStr: string): Promise<JWTPayload> {
  try {
    return await verifyKeycloakToken(tokenStr);
  } catch {
    return verifyStaticSecret(tokenStr);     // ← supply-chain risk
  }
}

function verifyStaticSecret(tokenStr: string): JWTPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'changeme-generate-a-secure-random-string') {
    throw new UnauthorizedError('JWT secret not configured');
  }
  return jwt.verify(tokenStr, secret) as JWTPayload;
}
```

Any transient Keycloak failure — network blip, JWKS rotation lag, cluster restart, expired CA on the Keycloak hostname — caused `verifyKeycloakToken` to throw, and the `catch` silently downgraded JWT verification to an HMAC check against `process.env.JWT_SECRET`. An attacker who obtained `JWT_SECRET` (committed by accident, leaked through a misconfigured logger, exfiltrated from a compromised CI runner) could thereafter forge tokens that the API would accept unconditionally even with Keycloak healthy. The fallback is the entire attack surface — no exploit chain needed.

## The fix

Two-file surgical change:

| File | Change |
|---|---|
| `server/src/middleware/auth.ts` | Removed `verifyStaticSecret` function entirely (dead post-fix); simplified `verifyToken` to a single `return await verifyKeycloakToken(tokenStr)` line; updated the inline header comment + the `authenticateJWT` JSDoc to reflect "Keycloak-issued JWT" rather than "Keycloak or static secret". |
| `.env.example` | Removed `JWT_SECRET=…`, `JWT_EXPIRY=…`, `JWT_REFRESH_EXPIRY=…` lines (all three are dead post-fix). Replaced with a comment pointing at the 0F closure + an explicit instruction to delete those variables from any pre-existing deployment environment. |

The `verifyKeycloakToken` function (which is the actual security boundary) is unchanged. It already verifies:

- Algorithm forced to `RS256` (rejects any HS256-signed token).
- Issuer locked to `${kcIssuerUrl}/realms/${kcRealm}` (rejects tokens issued by other realms or other Keycloaks).
- Signing key pulled from the live JWKS endpoint via the `getSigningKey` helper (rejects unknown kids).

After 0F, any failure path of `verifyKeycloakToken` propagates out of `verifyToken` and is caught by the `authenticateJWT` middleware's `.catch(next)`, producing `401 UNAUTHORIZED`. The middleware now **fails closed** on every Keycloak unavailability mode.

## Acceptance

### Env audit — zero active fallback uses

```
$ grep -rn '^[^#]*process\.env\.JWT_SECRET' server/ --include='*.ts'
(empty)

$ grep -n '^JWT_SECRET=' .env.example
(empty)
```

`process.env.JWT_SECRET` is no longer read anywhere in the source tree. `.env.example` no longer declares it.

The comment block above the new `verifyToken` (and a parallel `.env.example` comment) documents *why* the variable was removed — operators upgrading an old deployment see the explanation and know to delete the env-var.

### Static analysis

```
$ cd server && npx tsc --noEmit
(exit 0, no diagnostics)
```

### Tests

```
$ cd server && npx vitest run
 Test Files  42 passed (42)
      Tests  707 passed (707)
   Duration  3.59 s
```

The unit suite is unchanged from baseline (707 / 42). No test exercised the fallback path — the operating model's "Phase 15B STOP-gate" treatment of the issue meant no tests were written for the to-be-removed code.

### Fails-closed verification

The remaining `verifyKeycloakToken` raises in the following Keycloak unavailability modes:

- Network unreachable → `fetch` in `jwks-rsa` rejects → `getSigningKey` rejects → `await getSigningKey(...)` throws inside `verifyKeycloakToken` → propagates to `authenticateJWT` → `next(error)` → `401 UNAUTHORIZED`.
- JWKS returns 5xx → `jwks-rsa` rejects → same path as above.
- Token `kid` not in JWKS → `getSigningKey` callback receives an error → same path.
- Token signature invalid (forged) → `jwt.verify` throws → same path.
- Token issuer mismatch → `jwt.verify` rejects on `issuer` mismatch → same path.
- Token algorithm not RS256 (e.g. HS256 forged with the previously fallback-used secret) → `jwt.verify` rejects on `algorithms` mismatch → same path.

Each mode produces `401 UNAUTHORIZED` from the middleware. None silently downgrades or accepts an unsigned / wrongly-signed token. **Fails closed.**

## Out of scope

- The `DEMO_MODE` bypass at the top of `authenticateJWT` is a *separate* mechanism (operator-controlled, off by default, requires `DEMO_MODE=true` in the env) and is unchanged by 0F. The `KI-P11-002` / Phase 15B design doc owns the demo-mode hardening pass.
- The `X-Internal-Service-Key` header path (for n8n → API callbacks) is a separate trust boundary using a shared secret via `crypto.timingSafeEqual`, and is unchanged by 0F. Batch 0H corrects the header *name* mismatch but not the verification path.
- Keycloak realm MFA enforcement is batch 0G.

## Net Phase 0 effect

Batch 0F is `done` per the acceptance-signal protocol. Closes:

- KI-S5-006 (was Phase 15B STOP-gate primary issue)
- KI-S5-307 (deep-review P0 #7)

The KI register update itself is deferred to 0J closeout so all closed items can be reconciled in a single doc commit.

## Follow-on items

- The KI register reconciliation in 0J will mark KI-S5-006 + KI-S5-307 closed with this commit hash.
- Operators with `JWT_SECRET` set in production env files should delete it; the `.env.example` comment block records why.
- If the team ever needs an *operator-controlled* break-glass path (e.g. signing internal-tooling tokens for a non-Keycloak operator CLI), the right place is a separate, explicit, JSDoc-documented endpoint in `server/src/api/admin/` — not a silent fallback in the auth middleware.
