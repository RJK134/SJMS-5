import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Read-only repository helpers for HESAStudent. The composition
 * pipeline only needs to enumerate the cohort for a snapshot, so
 * write operations are intentionally not exposed here — the canonical
 * data flow into HESAStudent comes from the upstream Student domain
 * via the (yet to be wired) Data Futures sync, not from the
 * compose-return service.
 */

export async function findAll(): Promise<Array<unknown>> {
  return prisma.hESAStudent.findMany({
    orderBy: { husid: 'asc' },
  });
}

export async function getById(id: string) {
  return prisma.hESAStudent.findUnique({ where: { id } });
}

/**
 * Returns the HESAStudent rows that should appear in a return for
 * a given academic year. The current first-cut filter is loose: a
 * student is in the cohort when they have a `comdate` on or before
 * the year boundary AND their `enddate` is null or after the start
 * of the year. The boundary is encoded as the September 1st of the
 * starting year of the academic-year string ("YYYY/YY"). When
 * `comdate` / `enddate` are missing the row is included so
 * historic / migrated rows are not silently dropped.
 */
export async function findActiveForAcademicYear(academicYear: string): Promise<Array<unknown>> {
  const year = parseInt(academicYear.slice(0, 4), 10);
  const start = Number.isFinite(year) ? new Date(Date.UTC(year, 8, 1)) : null;
  const end = Number.isFinite(year) ? new Date(Date.UTC(year + 1, 7, 31)) : null;

  if (!start || !end) {
    return prisma.hESAStudent.findMany({ orderBy: { husid: 'asc' } });
  }

  const where: Prisma.HESAStudentWhereInput = {
    OR: [
      { comdate: null },
      { comdate: { lte: end } },
    ],
    AND: [
      {
        OR: [
          { enddate: null },
          { enddate: { gte: start } },
        ],
      },
    ],
  };

  return prisma.hESAStudent.findMany({
    where,
    orderBy: { husid: 'asc' },
  });
}
