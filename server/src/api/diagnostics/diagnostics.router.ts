/**
 * TEMPORARY DIAGNOSTIC ENDPOINT — READ-ONLY
 *
 * GET /api/v1/diagnostics
 *
 * Returns row counts and sample data for key tables to help investigate
 * production database state. This endpoint bypasses JWT authentication.
 * In production, DIAGNOSTIC_KEY must be set (non-empty); callers send
 * X-Diagnostic-Key. Outside production, the key is optional (open when unset).
 *
 * Remove this file and its mount in server/src/index.ts once diagnostics
 * are complete.
 */
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import logger from '../../utils/logger';
import prisma from '../../utils/prisma';

export const diagnosticsRouter = Router();

/** Avoid intermediaries or browsers caching counts, internal IDs, or error bodies. */
function setNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

diagnosticsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const diagnosticKey = process.env.DIAGNOSTIC_KEY?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !diagnosticKey) {
    setNoStoreHeaders(res);
    res.status(503).json({
      error: 'Diagnostics unavailable',
      detail:
        'Set a non-empty DIAGNOSTIC_KEY environment variable to enable this endpoint in production.',
    });
    return;
  }

  // When a key is configured, callers must send X-Diagnostic-Key: <value>.
  if (diagnosticKey) {
    const raw = req.headers['x-diagnostic-key'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || !timingSafeStringEqual(provided, diagnosticKey)) {
      setNoStoreHeaders(res);
      res.status(401).json({ error: 'Missing or invalid X-Diagnostic-Key header' });
      return;
    }
  }

  try {
    // ── Row counts ────────────────────────────────────────────────────────
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

    // ── Soft-delete breakdown for Person ─────────────────────────────────
    const [personActive, personSoftDeleted] = await Promise.all([
      prisma.person.count({ where: { deletedAt: null } }),
      prisma.person.count({ where: { deletedAt: { not: null } } }),
    ]);

    // ── Soft-delete breakdown for Student ─────────────────────────────────
    const [studentActive, studentSoftDeleted] = await Promise.all([
      prisma.student.count({ where: { deletedAt: null } }),
      prisma.student.count({ where: { deletedAt: { not: null } } }),
    ]);

    const softDeleteBreakdown = {
      person: { total: personCount, active: personActive, softDeleted: personSoftDeleted },
      student: { total: studentCount, active: studentActive, softDeleted: studentSoftDeleted },
    };

    // ── Sample data ───────────────────────────────────────────────────────
    let sampleStudent = null;
    let samplePerson = null;
    let note = null;

    if (studentCount > 0) {
      // Fetch one Student row with its linked Person
      // Omit names and other direct identifiers (UK GDPR) — internal IDs only.
      sampleStudent = await prisma.student.findFirst({
        select: {
          id: true,
          personId: true,
          feeStatus: true,
          entryRoute: true,
          deletedAt: true,
          createdAt: true,
          person: {
            select: {
              id: true,
              deletedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    } else if (personCount > 0) {
      // Students table is empty but Persons exist — explain the FK relationship
      note =
        'Students table is empty. Person rows exist but no Student record has been ' +
        'created for them yet. A Student row is created separately and references ' +
        'Person via the person_id foreign key (one-to-one). Compare personCount above ' +
        'to studentCount to see how many persons have no student record yet.';

      samplePerson = await prisma.person.findFirst({
        select: {
          id: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    setNoStoreHeaders(res);
    res.json({
      _meta: {
        description: 'TEMPORARY read-only diagnostic snapshot — remove after investigation',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? 'unknown',
      },
      counts: {
        personCount,
        studentCount,
        programmeCount,
        moduleCount,
        enrolmentCount,
        userCount,
      },
      softDeleteBreakdown,
      ...(sampleStudent !== null && { sampleStudent }),
      ...(samplePerson !== null && { samplePerson }),
      ...(note !== null && { note }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('Diagnostic query failed', { error: message, stack });
    // Do not echo DB/Prisma details to the client (information disclosure).
    setNoStoreHeaders(res);
    res.status(500).json({ error: 'Diagnostic query failed' });
  }
});
