#!/usr/bin/env tsx
/**
 * SJMS 2.5 — Vercel + Neon pre-flight diagnostic
 *
 * One-shot read-only diagnostic that walks the entire deploy chain and
 * reports which link is broken. Designed to be run from any operator
 * machine (or inside Vercel) when the staff/student/applicant portals
 * are loading but showing no data.
 *
 * Usage (local operator machine):
 *   DATABASE_URL=<neon-pooled-url> \
 *   DIRECT_URL=<neon-unpooled-url> \
 *   API_URL=https://<your-server-project>.vercel.app \
 *   CLIENT_URL=https://<your-client-project>.vercel.app \
 *   INTERNAL_SERVICE_KEY=<key> \
 *   npx tsx scripts/diagnose-vercel-neon.ts
 *
 * Skips checks for variables that are not set, so it works as a partial
 * probe even when you only have part of the chain wired up.
 *
 * Exit codes:
 *   0 — all configured checks passed
 *   1 — at least one configured check failed (the report tells you which)
 */

import { PrismaClient } from '@prisma/client';

type Status = 'OK' | 'WARN' | 'FAIL' | 'SKIP';

interface CheckResult {
  step: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];

function record(step: string, status: Status, detail: string) {
  results.push({ step, status, detail });
  const icon = status === 'OK' ? '✓' : status === 'WARN' ? '⚠' : status === 'FAIL' ? '✗' : '·';
  console.log(`  ${icon}  ${step.padEnd(38)} ${detail}`);
}

function hr(char = '─', width = 78) {
  console.log(char.repeat(width));
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username || '(no user)'}:***@${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return '(unparseable)';
  }
}

async function probeUrl(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  hr('═');
  console.log('  SJMS 2.5 — Vercel + Neon pre-flight diagnostic');
  console.log(`  Run at: ${new Date().toISOString()}`);
  hr('═');
  console.log('');
  console.log('Configured environment variables:');
  console.log(`  DATABASE_URL          ${process.env.DATABASE_URL ? redact(process.env.DATABASE_URL) : '(unset)'}`);
  console.log(`  DIRECT_URL            ${process.env.DIRECT_URL ? redact(process.env.DIRECT_URL) : '(unset)'}`);
  console.log(`  API_URL               ${process.env.API_URL ?? '(unset)'}`);
  console.log(`  CLIENT_URL            ${process.env.CLIENT_URL ?? '(unset)'}`);
  console.log(`  INTERNAL_SERVICE_KEY  ${process.env.INTERNAL_SERVICE_KEY ? '(set, ' + process.env.INTERNAL_SERVICE_KEY.length + ' chars)' : '(unset)'}`);
  console.log(`  DEMO_MODE             ${process.env.DEMO_MODE ?? '(unset)'}`);
  console.log(`  CORS_ORIGIN           ${process.env.CORS_ORIGIN ?? '(unset)'}`);
  console.log('');
  hr();

  // ── 1. DATABASE_URL connectivity & basic shape ───────────────────────────
  console.log('1. Database connectivity (Neon Postgres)');
  hr();
  if (!process.env.DATABASE_URL) {
    record('DATABASE_URL is set', 'FAIL', 'DATABASE_URL env var is not set. The server cannot reach Postgres without it. Set this in Vercel → Project Settings → Environment Variables for the server project.');
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(process.env.DATABASE_URL);
      record('DATABASE_URL parses', 'OK', `host=${parsed.host} db=${parsed.pathname.replace(/^\//, '')}`);
    } catch {
      record('DATABASE_URL parses', 'FAIL', 'Connection string is malformed.');
    }

    if (parsed) {
      const schema = parsed.searchParams.get('schema');
      if (schema === 'sjms_app') {
        record('DATABASE_URL ?schema=sjms_app', 'OK', 'Correct schema pinned. SJMS tables live in sjms_app, not public.');
      } else {
        record('DATABASE_URL ?schema=sjms_app', 'FAIL', `?schema=${schema ?? '(missing)'} — SJMS tables live in sjms_app. Append ?schema=sjms_app or migrations will land in public and the server will see an empty database.`);
      }

      if (parsed.host.includes('neon.tech')) {
        record('DATABASE_URL points at Neon', 'OK', 'Neon hostname detected.');
        if (parsed.searchParams.get('sslmode') !== 'require') {
          record('?sslmode=require', 'WARN', 'Neon requires SSL. Append ?sslmode=require (most Neon copy-paste URLs already include it).');
        } else {
          record('?sslmode=require', 'OK', 'SSL required.');
        }
      } else {
        record('DATABASE_URL points at Neon', 'WARN', `Hostname is ${parsed.host}. Production should use Neon (*.neon.tech). If you are running this against local Docker Postgres that is fine — ignore the warning.`);
      }
    }

    // Live connect & probe row counts
    let connUrl = process.env.DATABASE_URL;
    try {
      const p = new URL(connUrl);
      p.searchParams.set('connection_limit', '1');
      connUrl = p.toString();
    } catch { /* leave as-is */ }

    const prisma = new PrismaClient({ datasources: { db: { url: connUrl } }, log: [] });
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      record('Postgres reachable', 'OK', 'SELECT 1 returned. Database is live.');

      try {
        const [persons, programmes, students, enrolments] = await Promise.all([
          prisma.person.count(),
          prisma.programme.count(),
          prisma.student.count(),
          prisma.enrolment.count(),
        ]);
        const empty = persons === 0 || programmes === 0;
        record(
          'Seed data present',
          empty ? 'FAIL' : 'OK',
          `persons=${persons} programmes=${programmes} students=${students} enrolments=${enrolments}${empty ? " — seed has not run or failed. Trigger a Vercel redeploy with FORCE_SEED=true, or run 'npm run db:seed' locally against this DATABASE_URL." : ""}`,
        );
      } catch (countErr) {
        const msg = countErr instanceof Error ? countErr.message : String(countErr);
        if (msg.includes('does not exist')) {
          record('Seed data present', 'FAIL', "Table missing — migrations have not been applied. Run 'npx prisma migrate deploy' (with DIRECT_URL set) or trigger a Vercel redeploy so deploy-init.ts runs.");
        } else {
          record('Seed data present', 'FAIL', msg);
        }
      }
    } catch (connErr) {
      const msg = connErr instanceof Error ? connErr.message : String(connErr);
      record('Postgres reachable', 'FAIL', msg);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  // ── 2. DIRECT_URL guidance ──────────────────────────────────────────────
  console.log('');
  console.log('2. Migration connection (DIRECT_URL)');
  hr();
  if (!process.env.DIRECT_URL) {
    record('DIRECT_URL is set', 'WARN', 'Unset — Prisma migrations will use DATABASE_URL. On Neon with PGBouncer (the pooled endpoint) this can fail with prepared-statement collisions. Set DIRECT_URL to the unpooled Neon endpoint in Vercel.');
  } else {
    try {
      const direct = new URL(process.env.DIRECT_URL);
      const pooledTuningHint = direct.searchParams.has('pgbouncer');
      record('DIRECT_URL parses', 'OK', `host=${direct.host}`);
      if (pooledTuningHint) {
        record('DIRECT_URL is unpooled', 'FAIL', '?pgbouncer=true detected on DIRECT_URL — that is the pooled endpoint. DIRECT_URL must be the UNPOOLED Neon endpoint (no pgbouncer) so migrations get session-level connection state.');
      } else {
        record('DIRECT_URL is unpooled', 'OK', 'No pgbouncer flag — looks like the unpooled endpoint.');
      }
    } catch {
      record('DIRECT_URL parses', 'FAIL', 'Malformed connection string.');
    }
  }

  // ── 3. API reachability ─────────────────────────────────────────────────
  console.log('');
  console.log('3. API reachability (Vercel server project)');
  hr();
  if (!process.env.API_URL) {
    record('API_URL is set', 'SKIP', 'Set API_URL to your Vercel server project URL to probe live endpoints (e.g. https://sjms-2-5-server.vercel.app).');
  } else {
    const base = process.env.API_URL.replace(/\/+$/, '');

    const health = await probeUrl(`${base}/health`);
    if (health.status === 0) {
      record('GET /health', 'FAIL', `Network error: ${health.body}`);
    } else if (health.status === 200) {
      record('GET /health', 'OK', 'Server process is alive.');
    } else {
      record('GET /health', 'FAIL', `HTTP ${health.status} — server is unreachable or returning an error before the health route is mounted.`);
    }

    const apiHealth = await probeUrl(`${base}/api/health`);
    if (apiHealth.status === 200) {
      try {
        const parsed = JSON.parse(apiHealth.body);
        const dbState = parsed?.checks?.database ?? '(unknown)';
        record('GET /api/health', 'OK', `Server connected to its DATABASE_URL. checks.database=${dbState}`);
      } catch {
        record('GET /api/health', 'WARN', 'HTTP 200 but body was not JSON.');
      }
    } else if (apiHealth.status === 503) {
      record('GET /api/health', 'FAIL', '503 — server is up but its DATABASE_URL cannot reach Postgres. Re-check the server project\'s DATABASE_URL env var in Vercel.');
    } else if (apiHealth.status === 404) {
      record('GET /api/health', 'FAIL', '404 — Vercel is not routing /api/* to the Express server. Either the server project is not deployed, or the client project is responding (which means VITE_API_URL is pointing at the wrong project).');
    } else {
      record('GET /api/health', 'FAIL', `HTTP ${apiHealth.status}: ${apiHealth.body.slice(0, 200)}`);
    }

    // Authenticated probe via internal service key
    if (process.env.INTERNAL_SERVICE_KEY) {
      const students = await probeUrl(`${base}/api/v1/students?limit=5`, {
        headers: { 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY },
      });
      if (students.status === 200) {
        try {
          const parsed = JSON.parse(students.body);
          const count = Array.isArray(parsed?.data) ? parsed.data.length : 0;
          record('GET /api/v1/students', count > 0 ? 'OK' : 'WARN', `Returned ${count} rows.${count === 0 ? ' Endpoint reachable + auth accepted, but the seed has not populated students.' : ''}`);
        } catch {
          record('GET /api/v1/students', 'WARN', 'HTTP 200 but body was not JSON.');
        }
      } else if (students.status === 401 || students.status === 403) {
        record('GET /api/v1/students', 'FAIL', `HTTP ${students.status} — INTERNAL_SERVICE_KEY mismatch. The value sent does not equal the server project\'s env var.`);
      } else {
        record('GET /api/v1/students', 'FAIL', `HTTP ${students.status}: ${students.body.slice(0, 200)}`);
      }
    } else {
      record('Auth probe with service key', 'SKIP', 'Set INTERNAL_SERVICE_KEY to verify the /api/v1/* routes return real data.');
    }
  }

  // ── 4. Client reachability ──────────────────────────────────────────────
  console.log('');
  console.log('4. Client reachability (Vercel client project)');
  hr();
  if (!process.env.CLIENT_URL) {
    record('CLIENT_URL is set', 'SKIP', 'Set CLIENT_URL to your Vercel client project URL to probe the SPA shell.');
  } else {
    const root = await probeUrl(process.env.CLIENT_URL);
    if (root.status === 200) {
      const hasVite = root.body.includes('id="root"') || root.body.includes('vite');
      record('GET /', hasVite ? 'OK' : 'WARN', hasVite ? 'Vite SPA shell served.' : 'HTTP 200 but the body does not look like the SJMS SPA.');
    } else {
      record('GET /', 'FAIL', `HTTP ${root.status}.`);
    }
  }

  // ── 5. CORS sanity check (only meaningful when BOTH are set) ────────────
  if (process.env.CLIENT_URL && process.env.API_URL) {
    console.log('');
    console.log('5. CORS allow-list');
    hr();
    const apiBase = process.env.API_URL.replace(/\/+$/, '');
    const clientOrigin = new URL(process.env.CLIENT_URL).origin;
    const preflight = await probeUrl(`${apiBase}/api/v1/students`, {
      method: 'OPTIONS',
      headers: {
        Origin: clientOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,x-dev-persona,content-type',
      },
    });
    if (preflight.status === 0) {
      record('CORS preflight', 'FAIL', `Network error: ${preflight.body}`);
    } else if (preflight.status === 204 || preflight.status === 200) {
      record('CORS preflight', 'OK', `OPTIONS returned ${preflight.status} for Origin: ${clientOrigin}.`);
    } else {
      record('CORS preflight', 'FAIL', `OPTIONS returned ${preflight.status} — the server is rejecting cross-origin requests from ${clientOrigin}. Add it to CORS_ORIGIN on the server project (Vercel → Settings → Environment Variables).`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  hr('═');
  const counts = results.reduce<Record<Status, number>>(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    { OK: 0, WARN: 0, FAIL: 0, SKIP: 0 },
  );
  console.log(`  SUMMARY: ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`);
  hr('═');

  if (counts.FAIL > 0) {
    console.log('');
    console.log('Next steps (in order):');
    let stepNum = 1;
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`  ${stepNum++}. ${r.step}: ${r.detail}`);
    }
    console.log('');
    console.log('See docs/VERCEL-NEON-FIX-GUIDE.md for a full operator walkthrough.');
    process.exit(1);
  }

  console.log('');
  console.log('All configured checks passed. If portals are still empty, verify:');
  console.log('  - VITE_API_URL on the CLIENT Vercel project equals API_URL/api');
  console.log('  - DEMO_MODE=true on the SERVER project (or Keycloak is configured)');
  console.log('  - The browser network tab shows requests reaching /api/v1/*');
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('[diagnose-vercel-neon] Unhandled error:', err);
  process.exit(2);
});
