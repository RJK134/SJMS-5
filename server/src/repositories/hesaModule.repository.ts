import prisma from '../utils/prisma';

/**
 * Read-only repository helpers for HESAModule. Same rationale as
 * `hesaStudent.repository`: the composition pipeline only needs to
 * read the cohort.
 */

export async function findByAcademicYear(academicYear: string): Promise<Array<unknown>> {
  return prisma.hESAModule.findMany({
    where: { academicYear },
    orderBy: { modId: 'asc' },
  });
}

export async function getById(id: string) {
  return prisma.hESAModule.findUnique({ where: { id } });
}
