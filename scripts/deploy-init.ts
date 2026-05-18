#!/usr/bin/env tsx
/**
 * SJMS 2.5 — Deploy initialisation (resilient seed)
 *
 * 1. Apply pending Prisma migrations via `prisma migrate deploy`.
 * 2. If the database is empty, run the seed; failures are non-fatal so the
 *    server can still start and serve the API.
 *
 * Designed for Vercel + Neon. The script:
 *   - Logs the redacted DB host so operators can confirm the deployed
 *     server is pointed at the expected Neon project / branch.
 *   - Uses the unpooled `DIRECT_URL` for `prisma migrate deploy` when set,
 *     because PGBouncer (the Neon pooled endpoint) does not carry the
 *     session state migrations need. Falls back to `DATABASE_URL` if
 *     `DIRECT_URL` is not configured.
 *   - Prints row counts before AND after seeding so the operator can see
 *     in Vercel's Runtime Logs whether seed data actually landed (instead
 *     of just trusting an exit code).
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SEED_ADVISORY_LOCK_ID = 728193456;

function run(cmd: string, extraEnv: Record<string, string> = {}) {
  console.log(`[deploy-init] $ ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
  });
}

function redactConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host || '(no host)';
    const database = parsed.pathname.replace(/^\//, '') || '(no db)';
    const schema = parsed.searchParams.get('schema') ?? '(default)';
    const pooled = parsed.searchParams.has('pgbouncer') ? ' [pgbouncer]' : '';
    return `${parsed.protocol}//${parsed.username || '(no user)'}:***@${host}/${database} schema=${schema}${pooled}`;
  } catch {
    return '(unparseable connection string)';
  }
}

function isValidConnectionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Require a non-empty database name (pathname should have content after /)
    const database = parsed.pathname.replace(/^\//, '').trim();
    if (!database) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // On Vercel this script runs at BUILD time (chained off the buildCommand
  // in server/vercel.json), because Vercel never invokes `npm start` for
  // serverless deployments. On Docker / local long-running setups it runs
  // at runtime as part of `npm start`. The behaviour is identical either
  // way — only the invocation surface differs.
  const isVercelBuild = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

  if (!process.env.DATABASE_URL) {
    if (isVercelBuild) {
      // At build time a missing DATABASE_URL is a hard misconfiguration —
      // the resulting deployment will boot with no migrations and no seed,
      // and every portal page will appear empty. Fail loudly so the
      // operator sees this in the Build Logs and fixes the env var instead
      // of shipping a broken deploy.
      console.error('[deploy-init] FATAL: DATABASE_URL is not set in the Vercel build environment. Set it (and DIRECT_URL) under Settings → Environment Variables with scope "Build" enabled, then redeploy. See docs/VERCEL-NEON-FIX-GUIDE.md.');
      process.exit(1);
    }
    console.warn('[deploy-init] DATABASE_URL not set — skipping migrate/seed.');
    return;
  }

  console.log(`[deploy-init] Running at ${isVercelBuild ? 'BUILD time on Vercel' : 'startup'}.`);
  console.log(`[deploy-init] DATABASE_URL → ${redactConnectionString(process.env.DATABASE_URL)}`);
  if (process.env.DIRECT_URL) {
    console.log(`[deploy-init] DIRECT_URL   → ${redactConnectionString(process.env.DIRECT_URL)}`);
  } else {
    console.log('[deploy-init] DIRECT_URL not set — migrations will use DATABASE_URL. On Neon with PGBouncer, set DIRECT_URL to the unpooled endpoint (see docs/VERCEL-RUNBOOK.md §4.2) if migrations fail with prepared-statement errors.');
  }

  console.log('[deploy-init] Running prisma migrate deploy...');
  // Migrations require a session-mode connection; pgbouncer transaction
  // mode trips on prepared statements. When DIRECT_URL is configured the
  // schema's `directUrl` already routes migrations to it, but we also
  // export the override on the spawned process for older Prisma CLIs
  // that consult DATABASE_URL only.
  const migrateEnv = process.env.DIRECT_URL && isValidConnectionUrl(process.env.DIRECT_URL)
    ? { DATABASE_URL: process.env.DIRECT_URL }
    : {};
  if (process.env.DIRECT_URL && !isValidConnectionUrl(process.env.DIRECT_URL)) {
    console.warn(`[deploy-init] WARNING: DIRECT_URL is malformed (missing database name). Falling back to DATABASE_URL. Please fix DIRECT_URL in the environment variables.`);
    // Explicitly unset the malformed DIRECT_URL so Prisma doesn't try to use it
    migrateEnv.DIRECT_URL = '';
  }
  run('npx prisma migrate deploy', migrateEnv);

  try {
    let connUrl = process.env.DATABASE_URL;
    try {
      const parsed = new URL(connUrl);
      parsed.searchParams.set('connection_limit', '1');
      connUrl = parsed.toString();
    } catch {
      // Non-parseable URL; proceed without override.
    }

    const prisma = new PrismaClient({ datasources: { db: { url: connUrl } } });

    try {
      console.log('[deploy-init] Acquiring seed-guard advisory lock...');
      await prisma.$executeRawUnsafe(
        `SELECT pg_advisory_lock(${SEED_ADVISORY_LOCK_ID.toString()})`
      );

      console.log('[deploy-init] Checking whether the database is fully seeded...');
      // The authoritative signal is row counts, NOT the `_seed_completed_at`
      // SystemSetting marker. A restore / truncate / partial-recovery could
      // leave the marker row intact while wiping persons / programmes, which
      // would strand an environment if the marker were treated as sufficient
      // on its own. We therefore require Person AND Programme to both be
      // populated before skipping the seed; the marker is read for operator
      // observability and surfaced in the log line, but does not on its own
      // short-circuit the guard. A previous deploy that crashed mid-seed
      // could also leave Person rows in place but no Programme rows, so
      // checking Person alone (the original guard) would skip the re-seed
      // and leave the platform permanently broken. Requiring both catches
      // that partial-seed corner case.
      const seedMarker = await prisma.systemSetting.findUnique({
        where: { settingKey: '_seed_completed_at' },
      }).catch(() => null);

      const personCount = await prisma.person.count();
      const programmeCount = await prisma.programme.count();
      const looksFullySeeded = personCount > 0 && programmeCount > 0;
      // Whitespace-tolerant, case-insensitive match — Vercel dashboard
      // entries occasionally pick up surrounding whitespace or
      // inconsistent casing (`True`, `TRUE`, `" true "`). Matches the
      // `DEMO_MODE` guard pattern adopted in PR #225 (see
      // `server/src/middleware/auth.ts` authenticateJWT) so the operator
      // doesn't have to remember which envs need the strict form.
      const forceSeed = process.env.FORCE_SEED?.trim().toLowerCase() === 'true';

      if (looksFullySeeded && !forceSeed) {
        console.log(
          `[deploy-init] Database appears seeded (persons=${personCount}, programmes=${programmeCount}, marker=${seedMarker ? 'yes' : 'no'}) — skipping seed.`
        );
      } else {
        if (forceSeed) {
          console.log('[deploy-init] FORCE_SEED=true — bypassing seed-skip guard.');
        }
        console.log(
          `[deploy-init] Database not fully seeded (persons=${personCount}, programmes=${programmeCount}) — running seed...`
        );
        // The seed connects on its own DATABASE_URL. On Neon, the pooled
        // endpoint handles the bulk inserts fine, so we deliberately do
        // NOT override to DIRECT_URL here — the seed's many short
        // transactions benefit from PGBouncer pooling.
        run('npm run db:seed');
        // Print post-seed counts so the operator can see in Vercel's
        // Runtime Logs exactly what landed (or didn't). A successful
        // exit from `npm run db:seed` is not on its own proof of
        // populated tables — the seed catches exceptions in places.
        try {
          const [personAfter, programmeAfter, studentAfter, enrolmentAfter] = await Promise.all([
            prisma.person.count(),
            prisma.programme.count(),
            prisma.student.count(),
            prisma.enrolment.count(),
          ]);
          console.log(
            `[deploy-init] Post-seed row counts: persons=${personAfter}, programmes=${programmeAfter}, students=${studentAfter}, enrolments=${enrolmentAfter}`,
          );
          if (personAfter === 0 || programmeAfter === 0) {
            console.warn(
              '[deploy-init] WARNING: post-seed counts indicate the seed did not populate core tables. Check the seed output above for errors. The server will still start so /api/health remains reachable, but staff/student/applicant portals will appear empty until this is resolved.',
            );
          }
        } catch (countErr) {
          console.warn('[deploy-init] Could not read post-seed counts:', countErr);
        }
        // Best-effort completion marker. Failure here is non-fatal — the
        // looksFullySeeded check above will still catch a complete seed
        // on the next deploy.
        try {
          await prisma.systemSetting.upsert({
            where: { settingKey: '_seed_completed_at' },
            create: {
              settingKey: '_seed_completed_at',
              settingValue: new Date().toISOString(),
              category: 'deployment',
              description: 'Timestamp of the last successful seed run by deploy-init.',
            },
            update: {
              settingValue: new Date().toISOString(),
            },
          });
        } catch (markerErr) {
          console.warn('[deploy-init] Could not write _seed_completed_at marker:', markerErr);
        }
        console.log('[deploy-init] Seed complete.');
      }
    } finally {
      try {
        await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${SEED_ADVISORY_LOCK_ID.toString()})`);
      } catch {
        // best-effort
      }
      await prisma.$disconnect();
    }
  } catch (seedErr) {
    console.warn('[deploy-init] WARNING: seed step failed but continuing so the server can start.');
    console.warn('[deploy-init] Seed error:', seedErr);
  }
}

main().catch((err) => {
  console.error('[deploy-init] Migration phase failed:', err);
  process.exit(1);
});
