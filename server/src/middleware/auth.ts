import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import type { Role } from '../constants/roles';

// NOTE: `jwks-rsa` is deliberately NOT imported at the top of this module.
// jwks-rsa@4.0.1 declares `jose@^6.1.3` as a runtime dependency, but jose@5+
// is ESM-only while jwks-rsa's own source still uses `require('jose')`. The
// resulting ERR_REQUIRE_ESM is thrown the instant `jwks-rsa` is loaded, so
// putting the import at module level crashes the Vercel serverless cold
// start before any of our DEMO_MODE / AUTH_BYPASS / internal-service-key
// branches can fire. The import is therefore deferred into `getJwksClient()`
// below and only runs on the first request that actually needs Keycloak
// JWKS verification — which never happens in a DEMO_MODE deployment.
//
// Permanent fix tracked separately: migrate Keycloak verification to a
// fully ESM-native verifier (jose@v6 direct, or refactor to dynamic
// `await import()` in a module marked as ESM) so this lazy-load workaround
// can be removed. See PR #224 description for the open follow-up.

// ── Types ────────────────────────────────────────────────────────────────────

declare module 'express-serve-static-core' {
  interface Request {
    user?: JWTPayload;
  }
}

export interface JWTPayload {
  sub: string;
  email: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: Record<string, { roles: string[] }>;
  iat?: number;
  exp?: number;
}

// ── Dev auth bypass (local development only) ───────────────────────────────
// When AUTH_BYPASS=true and NODE_ENV !== 'production', skip JWT verification
// and inject a mock user on every request. NEVER active in production even
// if the env var is set.
//
// Since Phase 2 closeout (2026-04-11) the bypass exposes 4 personas keyed
// off the `X-Dev-Persona` header the client sends on every API call. The
// client derives the persona from the current hash route, so navigating
// to /#/student/... arrives at the server with X-Dev-Persona: student and
// downstream scoping middleware sees a plausible student identity instead
// of the old super-admin short-circuit. See client/src/lib/auth.ts.
if (process.env.AUTH_BYPASS === 'true' && process.env.NODE_ENV === 'production') {
  console.error('[auth] FATAL: AUTH_BYPASS must not be enabled in production. Exiting.');
  process.exit(1);
}

const AUTH_BYPASS =
    process.env.AUTH_BYPASS === 'true' && process.env.NODE_ENV === 'development' && process.env.SJMS_ALLOW_DEV_AUTH === '1';

export type DevPersona = 'admin' | 'academic' | 'student' | 'applicant';

// Admin set — administrative reach only; no teaching roles, so the admin
// persona cannot enter /academic/* in the client (portal role guards added
// in Phase 2 closeout part 1 enforce isolation).
const ADMIN_PERSONA_ROLES = [
  'super_admin',
  'system_admin',
  'registrar',
  'senior_registry_officer',
  'registry_officer',
  'admissions_manager',
  'admissions_officer',
  'admissions_tutor',
  'assessment_officer',
  'progression_officer',
  'graduation_officer',
  'finance_director',
  'finance_manager',
  'finance_officer',
  'quality_director',
  'quality_officer',
  'compliance_officer',
  'student_support_manager',
  'student_support_officer',
  'international_officer',
  'accommodation_officer',
];

// Academic set — teaching roles only; matches
// client/src/constants/roles.ts ACADEMIC_STAFF_ROLES.
const ACADEMIC_PERSONA_ROLES = [
  'dean',
  'associate_dean',
  'head_of_department',
  'programme_leader',
  'module_leader',
  'academic_staff',
  'lecturer',
  'senior_lecturer',
  'professor',
];

// DEMO_MODE synthetic admin role list — every role exported from
// server/src/constants/roles.ts. Used ONLY by the DEMO_MODE bypass path
// below so a public Vercel demo deployment (where Keycloak is not yet
// provisioned) has unrestricted access to every read endpoint. The synthetic admin
// already passes RBAC via the `super_admin` short-circuit in
// `requireRole`, but seeding the full role list also keeps any
// future role-based scoping path predictable: the admin/teaching/
// support short-circuits in data-scope.ts run BEFORE the student /
// applicant scoping branches, so adding student + applicant to the
// list does not silently re-scope the demo to a non-existent persona
// identity.
//
// Kept as a literal list rather than imported from constants/roles.ts
// so a future role addition is a deliberate, reviewable change here
// rather than a silent broadening of demo reach.
const DEMO_ADMIN_ROLES: readonly string[] = [
  'super_admin',
  'system_admin',
  'registrar',
  'senior_registry_officer',
  'registry_officer',
  'admissions_manager',
  'admissions_officer',
  'admissions_tutor',
  'assessment_officer',
  'progression_officer',
  'graduation_officer',
  'finance_director',
  'finance_manager',
  'finance_officer',
  'quality_director',
  'quality_officer',
  'compliance_officer',
  'dean',
  'associate_dean',
  'head_of_department',
  'programme_leader',
  'module_leader',
  'academic_staff',
  'lecturer',
  'senior_lecturer',
  'professor',
  'student_support_manager',
  'student_support_officer',
  'personal_tutor',
  'disability_advisor',
  'wellbeing_officer',
  'international_officer',
  'accommodation_officer',
  'student',
  'applicant',
  'public',
];

// Synthetic JWT payload used when DEMO_MODE === 'true'. Stable
// `sub: 'demo-admin'` so that data-scope.ts's DEV_PERSONA_IDENTITY
// table never matches it (admin roles short-circuit scoping anyway).
export const DEMO_USER_PAYLOAD: JWTPayload = {
  sub: 'demo-admin',
  email: 'demo@futureed.online',
  preferred_username: 'demo-admin',
  given_name: 'Demo',
  family_name: 'Admin',
  realm_access: { roles: [...DEMO_ADMIN_ROLES] },
};

// Persona → mock JWT payload. Where possible the display name matches a
// real seeded Person so the UI header ("Welcome, <first>") lines up with
// the data the persona can actually see. Seeded identities verified
// against the live DB on 2026-04-11:
//
//   admin      → Richard Knapp (cosmetic; there are no seeded admin
//                staff Persons — the staff table only contains teaching
//                roles. Kept as the project owner's name so the dev
//                workflow feels natural. scopeToUser short-circuits for
//                admin roles so no Person lookup happens.)
//   academic   → stf-0003 / per-stf-0003 / Zoe Price (Lecturer). Real
//                seeded teaching-staff Person. No seeded EMAIL contact
//                so the DEV_PERSONA_IDENTITY fast-path in data-scope.ts
//                bypasses the email lookup for this sub.
//   student    → per-stu-0001 / stu-0001 / James Taylor. Real seeded
//                student with an EMAIL contact of
//                james.taylor1@student.futurehorizons.ac.uk.
//   applicant  → per-app-0001 / Chloe Price. Real seeded applicant
//                Person. No seeded EMAIL contact so the fast-path
//                resolver handles it.
//
// The Comet smoke test round 1 F7 finding flagged the previous cosmetic
// names ("Lena Lecturer", "Anne Applicant") because they had no
// counterpart in the seed and made the persona dropdown look like a
// mock stub. Now the student + applicant names point at actual seed
// rows and the academic name points at an actual lecturer.
export const DEV_PERSONA_PAYLOADS: Record<DevPersona, JWTPayload> = {
  admin: {
    sub: 'dev-persona-admin',
    email: 'richard.knapp@fhe.ac.uk',
    preferred_username: 'richard.knapp',
    given_name: 'Richard',
    family_name: 'Knapp',
    realm_access: { roles: ADMIN_PERSONA_ROLES },
  },
  academic: {
    sub: 'dev-persona-academic',
    email: 'zoe.price@fhe.ac.uk',
    preferred_username: 'zoe.price',
    given_name: 'Zoe',
    family_name: 'Price',
    realm_access: { roles: ACADEMIC_PERSONA_ROLES },
  },
  student: {
    sub: 'dev-persona-student',
    email: 'james.taylor1@student.futurehorizons.ac.uk',
    preferred_username: 'james.taylor1',
    given_name: 'James',
    family_name: 'Taylor',
    realm_access: { roles: ['student'] },
  },
  applicant: {
    sub: 'dev-persona-applicant',
    email: 'chloe.price@applicant.futurehorizons.ac.uk',
    preferred_username: 'chloe.price',
    given_name: 'Chloe',
    family_name: 'Price',
    realm_access: { roles: ['applicant'] },
  },
};

function resolveDevPersona(raw: string | string[] | undefined): DevPersona {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'academic' || v === 'student' || v === 'applicant') return v;
  return 'admin';
}

if (AUTH_BYPASS && process.env.NODE_ENV === 'development' && process.env.SJMS_ALLOW_DEV_AUTH === '1') {
  console.warn(
    '[auth] AUTH_BYPASS is enabled — API requests are authenticated as one of ' +
      '4 dev personas (admin / academic / student / applicant), selected by the ' +
      'X-Dev-Persona request header. NEVER enable in production.',
  );
}

// ── JWKS Client (Keycloak public key verification) ──────────────────────────

// Internal URL for server→Keycloak calls (JWKS fetch, admin API) — Docker service name
const kcInternalUrl = process.env.KEYCLOAK_INTERNAL_URL || process.env.KEYCLOAK_URL || 'http://localhost:8080';
// Issuer URL for JWT validation — must match the `iss` claim in browser-issued tokens
const kcIssuerUrl = process.env.KEYCLOAK_ISSUER_URL || 'http://localhost:8080';
const kcRealm = process.env.KEYCLOAK_REALM || 'fhe';
const kcClientId = process.env.KEYCLOAK_CLIENT_ID || 'sjms-client';

// `jwksClient` is created lazily on first use to keep the jose@6 require()
// chain out of Vercel cold-start. The shape is left as `any` because
// `import type { JwksClient } from 'jwks-rsa'` would still cause TS to
// pull jwks-rsa's type files (harmless) but the value-level access is what
// must stay deferred. The lazy initializer narrows back to the real type
// at the call site via duck-typing on `.getSigningKey`.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jwksClient: any = null;

function getJwksClient(): { getSigningKey: (kid: string, cb: (err: Error | null, key?: { getPublicKey: () => string }) => void) => void } {
  if (jwksClient) return jwksClient;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('jwks-rsa');
  const factory = mod.default ?? mod;
  jwksClient = factory({
    jwksUri: `${kcInternalUrl}/realms/${kcRealm}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxAge: 600_000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  return jwksClient;
}

// ── Token Helpers ────────────────────────────────────────────────────────────

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!header.kid) return reject(new Error('No kid in token header'));
    getJwksClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      if (!key) return reject(new Error('No signing key returned for kid'));
      resolve(key.getPublicKey());
    });
  });
}

async function verifyKeycloakToken(tokenStr: string): Promise<JWTPayload> {
  const decoded = jwt.decode(tokenStr, { complete: true });
  if (!decoded) throw new UnauthorizedError('Invalid token format');

  const publicKey = await getSigningKey(decoded.header);

  return jwt.verify(tokenStr, publicKey, {
    algorithms: ['RS256'],
    issuer: `${kcIssuerUrl}/realms/${kcRealm}`,
  }) as JWTPayload;
}

function verifyStaticSecret(tokenStr: string): JWTPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'changeme-generate-a-secure-random-string') {
    throw new UnauthorizedError('JWT secret not configured');
  }
  return jwt.verify(tokenStr, secret) as JWTPayload;
}

async function verifyToken(tokenStr: string): Promise<JWTPayload> {
  try {
    return await verifyKeycloakToken(tokenStr);
  } catch {
    return verifyStaticSecret(tokenStr);
  }
}

function getUserRoles(payload: JWTPayload): string[] {
  const realmRoles = payload.realm_access?.roles || [];
  const clientRoles = payload.resource_access?.[kcClientId]?.roles || [];
  return [...new Set([...realmRoles, ...clientRoles])];
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Requires a valid JWT (Keycloak or static secret).
 * Attaches decoded payload to req.user.
 *
 * Also accepts X-Internal-Service-Key header for trusted internal
 * services (n8n, background jobs) running within the Docker network.
 */
export function authenticateJWT(req: Request, _res: Response, next: NextFunction): void {
  // DEMO_MODE: production-safe demo bypass (no Keycloak required).
  // WARNING — disables authentication entirely. Off by default; enabled
  // only when `DEMO_MODE` resolves to the literal string 'true' in the
  // runtime environment. The check is whitespace-tolerant and
  // case-insensitive so an env var set as `True`, `TRUE`, or with a
  // trailing newline on the Vercel dashboard still trips the bypass
  // (the previous strict `=== 'true'` check rejected those variants
  // and produced 401 UNAUTHORIZED for every request even though
  // DEMO_MODE was operator-set on the deployment).
  //
  // Persona resolution: the bypass honours the same `X-Dev-Persona`
  // request header the client sends in dev-auth mode (see
  // client/src/lib/api.ts and client/src/lib/auth.ts). Missing or
  // unknown values default to 'admin'. The 'admin' persona uses the
  // super-admin DEMO_USER_PAYLOAD (full role list — preserves prior
  // DEMO_MODE behaviour where every request was unconditionally
  // super_admin), while the academic / student / applicant personas
  // use the role-scoped DEV_PERSONA_PAYLOADS so the demo can simulate
  // those journeys against the real RBAC, audit, and webhook plumbing.
  if (process.env.DEMO_MODE?.trim().toLowerCase() === 'true') {
    const persona = resolveDevPersona(
      req.headers['x-dev-persona'] as string | undefined,
    );
    req.user =
      persona === 'admin'
        ? DEMO_USER_PAYLOAD
        : DEV_PERSONA_PAYLOADS[persona];
    return next();
  }
  if (AUTH_BYPASS && process.env.NODE_ENV === 'development' && process.env.SJMS_ALLOW_DEV_AUTH === '1') {
    const persona = resolveDevPersona(req.headers['x-dev-persona'] as string | undefined);
    req.user = DEV_PERSONA_PAYLOADS[persona];
    return next();
  }

  // Internal service key bypass — trusted Docker-internal callers only
  const expectedKey = process.env.INTERNAL_SERVICE_KEY;
    const serviceKey = req.headers['x-internal-service-key'] as string | undefined;
  if (expectedKey && serviceKey) {
    const DEV_KEY = 'sjms-dev-internal-service-key-do-not-use-in-production-min64chars';
    if (!expectedKey || expectedKey.length < 32) {
      return next(new ForbiddenError('Internal service key is configured incorrectly — must be at least 32 characters'));
    }
    if (process.env.NODE_ENV === 'production' && expectedKey === DEV_KEY) {
      return next(new ForbiddenError('Default development service key cannot be used in production — set INTERNAL_SERVICE_KEY to a unique random value'));
    }
    const keyBuf = Buffer.from(serviceKey);
    const expectedBuf = Buffer.from(expectedKey);
    if (keyBuf.length !== expectedBuf.length || !timingSafeEqual(keyBuf, expectedBuf)) {
      return next(new ForbiddenError('Invalid internal service key'));
    }
    req.user = {
      sub: 'n8n-service',
      email: 'n8n-service@fhe.ac.uk',
      preferred_username: 'n8n-service',
      given_name: 'n8n',
      family_name: 'Service',
      realm_access: { roles: ['super_admin', 'system_admin'] },
    };
    return next();
  }

  const tokenStr = extractToken(req);
  if (!tokenStr) {
    return next(new UnauthorizedError('No authentication token provided'));
  }

  verifyToken(tokenStr)
    .then(payload => {
      req.user = payload;
      next();
    })
    .catch(() => next(new UnauthorizedError('Invalid or expired token')));
}

/**
 * Requires the authenticated user to have at least one of the specified roles.
 * Keycloak composite roles are resolved server-side — a user with "dean"
 * will have all descendant roles in the token automatically.
 */
export function requireRole(...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRoles = getUserRoles(req.user);

    // super_admin bypasses all role checks — system superuser
    if (userRoles.includes('super_admin')) {
      return next();
    }

    const hasRole = roles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return next(new ForbiddenError(`Required role(s): ${roles.join(', ')}`));
    }

    next();
  };
}

/**
 * Optionally attaches user if a valid token is present.
 * Does not reject unauthenticated requests.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  if (AUTH_BYPASS && process.env.NODE_ENV === 'development' && process.env.SJMS_ALLOW_DEV_AUTH === '1') {
    const persona = resolveDevPersona(req.headers['x-dev-persona'] as string | undefined);
    req.user = DEV_PERSONA_PAYLOADS[persona];
    return next();
  }

  const tokenStr = extractToken(req);
  if (!tokenStr) return next();

  verifyToken(tokenStr)
    .then(payload => {
      req.user = payload;
      next();
    })
    .catch(() => next());
}

/**
 * Requires the authenticated user to own the resource OR have an admin role.
 */
export function requireOwnerOrRole(getUserId: (req: Request) => string | undefined, ...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRoles = getUserRoles(req.user);

    // super_admin bypasses all ownership and role checks
    if (userRoles.includes('super_admin')) {
      return next();
    }

    const resourceUserId = getUserId(req);
    if (resourceUserId && req.user.sub === resourceUserId) {
      return next();
    }

    const hasRole = roles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return next(new ForbiddenError('You do not have permission to access this resource'));
    }

    next();
  };
}
