#!/usr/bin/env tsx
/**
 * SJMS 2.5 — Production Database Diagnostics
 *
 * Read-only snapshot of the production database state.
 * Queries row counts, samples Student data, and probes the health endpoint.
 *
 * Usage:
 *   DATABASE_URL=<url> tsx scripts/diagnostics.ts
 *
 * NOTE: This script makes NO writes. All queries are SELECT / COUNT only.
 */

import { PrismaClient } from '@prisma/client';

// ── Helpers ──────────────────────────────────────────────────────────────

function hr(char = '─', width = 72) {
  return char.repeat(width);
}

function section(title: string) {
  console.log('');
  console.log(hr('═'));
  console.log(`  ${title}`);
  console.log(hr('═'));
}

function row(label: string, value: unknown) {
  const lpad = label.padEnd(22);
  console.log(`  ${lpad}  ${String(value)}`);
}

function note(msg: string) {
  console.log(`  ℹ  ${msg}`);
}

function warn(msg: string) {
  console.log(`  ⚠  ${msg}`);
}

// ── Health probe ─────────────────────────────────────────────────────────

async function probeHealth(url: string): Promise<void> {
  section('HEALTH ENDPOINT');
  console.log(`  Target: ${url}`);
  console.log('');

  try {
    // Node 18+ has native fetch; tsx runs on Node ≥ 20 per engines field.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    const body = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    row('HTTP status', `${res.status} ${res.statusText}`);
    row('Response body', JSON.stringify(parsed, null, 2).replace(/\n/g, '\n' + ' '.repeat(26)));
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      warn('Request timed out after 5 s — server may be unreachable from this context.');
    } else {
      warn(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      note('This is expected if the script is not running inside the same Vercel deployment / private network as the API.');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(hr('═'));
  console.log('  SJMS 2.5 — Production Database Diagnostics');
  console.log(`  Run at: ${new Date().toISOString()}`);
  console.log(hr('═'));

  if (!process.env.DATABASE_URL) {
    console.error('\n  ✗  DATABASE_URL is not set. Aborting.\n');
    process.exit(1);
  }

  // Use a single connection for the entire diagnostic run.
  let connUrl = process.env.DATABASE_URL;
  try {
    const parsed = new URL(connUrl);
    parsed.searchParams.set('connection_limit', '1');
    connUrl = parsed.toString();
  } catch {
    // Non-parseable URL — proceed as-is.
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: connUrl } },
    log: [],
  });

  try {
    // ── 1. Row counts ──────────────────────────────────────────────────
    section('ROW COUNTS  (all tables, including soft-deleted rows)');

    const [
      personCount,
      studentCount,
      programmeCount,
      moduleCount,
      enrolmentCount,
      userCount,
    ] = await Promise.all([
      prisma.person.count(),
      prisma.student.count(),
      prisma.programme.count(),
      prisma.module.count(),
      prisma.enrolment.count(),
      prisma.user.count(),
    ]);

    // NOTE: There is no Tenant model in the SJMS 2.5 schema.
    // Multi-tenancy is handled at the application layer, not as a DB entity.

    console.log('');
    console.log('  Table                    Total rows');
    console.log('  ' + hr('-', 40));
    row('Person', personCount);
    row('Student', studentCount);
    row('Programme', programmeCount);
    row('Module', moduleCount);
    row('Enrolment', enrolmentCount);
    row('User', userCount);
    row('Tenant', 'n/a — no Tenant model in schema');

    // ── 2. Soft-delete breakdown ───────────────────────────────────────
    section('SOFT-DELETE BREAKDOWN');

    const [
      personActive,
      personDeleted,
      studentActive,
      studentDeleted,
      enrolmentActive,
      enrolmentDeleted,
    ] = await Promise.all([
      prisma.person.count({ where: { deletedAt: null } }),
      prisma.person.count({ where: { deletedAt: { not: null } } }),
      prisma.student.count({ where: { deletedAt: null } }),
      prisma.student.count({ where: { deletedAt: { not: null } } }),
      prisma.enrolment.count({ where: { deletedAt: null } }),
      prisma.enrolment.count({ where: { deletedAt: { not: null } } }),
    ]);

    console.log('');
    console.log('  Table        Active (deletedAt IS NULL)   Soft-deleted (deletedAt NOT NULL)');
    console.log('  ' + hr('-', 68));
    console.log(
      `  ${'Person'.padEnd(12)} ${String(personActive).padStart(26)}   ${String(personDeleted).padStart(33)}`
    );
    console.log(
      `  ${'Student'.padEnd(12)} ${String(studentActive).padStart(26)}   ${String(studentDeleted).padStart(33)}`
    );
    console.log(
      `  ${'Enrolment'.padEnd(12)} ${String(enrolmentActive).padStart(26)}   ${String(enrolmentDeleted).padStart(33)}`
    );

    // ── 3. Student / Person relationship analysis ──────────────────────
    section('STUDENT / PERSON RELATIONSHIP ANALYSIS');
    console.log('');

    if (studentCount > 0) {
      note(`${studentCount} Student row(s) found. Fetching one sample with linked Person...`);
      console.log('');

      const sample = await prisma.student.findFirst({
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              deletedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (sample) {
        console.log('  Sample Student row (oldest by createdAt):');
        console.log('  ' + hr('-', 50));
        row('student.id', sample.id);
        row('student.personId', sample.personId);
        row('student.studentNumber', sample.studentNumber);
        row('student.feeStatus', sample.feeStatus);
        row('student.entryRoute', sample.entryRoute);
        row('student.deletedAt', sample.deletedAt?.toISOString() ?? 'null (active)');
        row('student.createdAt', sample.createdAt.toISOString());
        console.log('');
        console.log('  Linked Person:');
        console.log('  ' + hr('-', 50));
        row('person.id', sample.person.id);
        row('person.firstName', sample.person.firstName);
        row('person.lastName', sample.person.lastName);
        row('person.deletedAt', sample.person.deletedAt?.toISOString() ?? 'null (active)');
      }
    } else if (personCount > 0) {
      warn(`${personCount} Person row(s) exist but Student count is 0.`);
      console.log('');
      note('Foreign key relationship: Student.personId → Person.id (1-to-1, unique).');
      note('Each Person can have at most one Student record.');
      note('');
      note('Possible reasons Students are empty while Persons exist:');
      note('  1. The seed created Person rows but the Student creation step failed or');
      note('     was not reached (e.g. a constraint violation or missing required field).');
      note('  2. The seed was run in a partial state — Person rows committed but the');
      note('     transaction for Student rows was rolled back.');
      note('  3. Student rows were soft-deleted or hard-deleted after seeding.');
      note('  4. The seed script seeds Persons first and Students in a later phase');
      note('     that did not complete.');
      console.log('');
      note('Recommended next step: inspect the seed script (prisma/seed.ts) to');
      note('confirm whether Student creation is conditional or guarded by a check');
      note('that may have short-circuited on a non-empty Person table.');

      // Show a sample Person so we can see what was seeded.
      const samplePerson = await prisma.person.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      if (samplePerson) {
        console.log('');
        console.log('  Sample Person row (oldest by createdAt):');
        console.log('  ' + hr('-', 50));
        row('person.id', samplePerson.id);
        row('person.firstName', samplePerson.firstName);
        row('person.lastName', samplePerson.lastName);
        row('person.dateOfBirth', samplePerson.dateOfBirth.toISOString().split('T')[0]);
        row('person.deletedAt', samplePerson.deletedAt?.toISOString() ?? 'null (active)');
        row('person.createdAt', samplePerson.createdAt.toISOString());
      }
    } else {
      warn('Both Person and Student tables are empty.');
      note('The database appears to be in a pre-seed state.');
    }

    // ── 4. Programme & Module sample ───────────────────────────────────
    section('PROGRAMME & MODULE SAMPLE');
    console.log('');

    if (programmeCount > 0) {
      const sampleProgramme = await prisma.programme.findFirst({
        select: {
          id: true,
          title: true,
          level: true,
          status: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (sampleProgramme) {
        console.log('  Sample Programme row (oldest by createdAt):');
        console.log('  ' + hr('-', 50));
        row('programme.id', sampleProgramme.id);
        row('programme.title', sampleProgramme.title);
        row('programme.level', sampleProgramme.level);
        row('programme.status', sampleProgramme.status);
        row('programme.deletedAt', sampleProgramme.deletedAt?.toISOString() ?? 'null (active)');
        row('programme.createdAt', sampleProgramme.createdAt.toISOString());
      }
    } else {
      note('No Programme rows found.');
    }

    if (moduleCount > 0) {
      console.log('');
      const sampleModule = await prisma.module.findFirst({
        select: {
          id: true,
          title: true,
          credits: true,
          status: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (sampleModule) {
        console.log('  Sample Module row (oldest by createdAt):');
        console.log('  ' + hr('-', 50));
        row('module.id', sampleModule.id);
        row('module.title', sampleModule.title);
        row('module.credits', sampleModule.credits);
        row('module.status', sampleModule.status);
        row('module.deletedAt', sampleModule.deletedAt?.toISOString() ?? 'null (active)');
        row('module.createdAt', sampleModule.createdAt.toISOString());
      }
    } else {
      note('No Module rows found.');
    }

    // ── 5. Enrolment sample ────────────────────────────────────────────
    section('ENROLMENT SAMPLE');
    console.log('');

    if (enrolmentCount > 0) {
      const sampleEnrolment = await prisma.enrolment.findFirst({
        select: {
          id: true,
          studentId: true,
          programmeId: true,
          academicYear: true,
          yearOfStudy: true,
          modeOfStudy: true,
          status: true,
          feeStatus: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (sampleEnrolment) {
        console.log('  Sample Enrolment row (oldest by createdAt):');
        console.log('  ' + hr('-', 50));
        row('enrolment.id', sampleEnrolment.id);
        row('enrolment.studentId', sampleEnrolment.studentId);
        row('enrolment.programmeId', sampleEnrolment.programmeId);
        row('enrolment.academicYear', sampleEnrolment.academicYear);
        row('enrolment.yearOfStudy', sampleEnrolment.yearOfStudy);
        row('enrolment.modeOfStudy', sampleEnrolment.modeOfStudy);
        row('enrolment.status', sampleEnrolment.status);
        row('enrolment.feeStatus', sampleEnrolment.feeStatus);
        row('enrolment.deletedAt', sampleEnrolment.deletedAt?.toISOString() ?? 'null (active)');
        row('enrolment.createdAt', sampleEnrolment.createdAt.toISOString());
      }
    } else {
      note('No Enrolment rows found.');
    }

    // ── 6. Health endpoint probe ───────────────────────────────────────
    const healthUrl = process.env.HEALTH_URL ?? 'http://sjmsserver:3001/api/health';
    await probeHealth(healthUrl);

    // ── 7. Summary ─────────────────────────────────────────────────────
    section('SUMMARY');
    console.log('');
    row('Person rows', personCount);
    row('Student rows', studentCount);
    row('Programme rows', programmeCount);
    row('Module rows', moduleCount);
    row('Enrolment rows', enrolmentCount);
    row('User rows', userCount);
    console.log('');

    if (personCount > 0 && studentCount === 0) {
      warn('ATTENTION: Persons exist but no Students — seed likely ran partially.');
      note('Recovery: re-run the seed (with the advisory lock guard bypassed or');
      note('after clearing Person rows) or create Student rows directly.');
    } else if (personCount > 0 && studentCount > 0 && enrolmentCount === 0) {
      warn('ATTENTION: Students exist but no Enrolments — enrolment step may have failed.');
    } else if (personCount === 0) {
      warn('ATTENTION: Database is empty — seed has not run successfully.');
    } else {
      note('Database appears to be in a consistent seeded state.');
    }

    console.log('');
    console.log(hr('═'));
    console.log('  Diagnostics complete. No data was modified.');
    console.log(hr('═'));
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n  ✗  Diagnostics failed with an unhandled error:');
  console.error(err);
  process.exit(1);
});
