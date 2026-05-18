import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { type CursorPaginationParams, buildCursorPaginatedResponse, safeOrderBy } from '../utils/pagination';
import { PROGRESSION_RECORD_SORT } from '../utils/repository-sort-allow-lists';

export interface ProgressionRecordFilters {
  enrolmentId?: string;
  decision?: string;
}

export async function list(filters: ProgressionRecordFilters = {}, pagination: CursorPaginationParams) {
  const where: Prisma.ProgressionRecordWhereInput = {
    deletedAt: null,
    ...(filters.enrolmentId && { enrolmentId: filters.enrolmentId }),
    ...(filters.decision && { decision: filters.decision as any }),
  };

  const [data, total] = await Promise.all([
    prisma.progressionRecord.findMany({
      where,
      include: { enrolment: { include: { student: { include: { person: true } }, programme: true } } },
      take: pagination.limit + 1, ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, PROGRESSION_RECORD_SORT),
    }),
    prisma.progressionRecord.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.progressionRecord.findFirst({
    where: { id, deletedAt: null },
    include: {
      enrolment: {
        include: { student: { include: { person: true } }, programme: true },
      },
    },
  });
}

export async function create(data: Prisma.ProgressionRecordUncheckedCreateInput) {
  return prisma.progressionRecord.create({ data });
}

export async function update(id: string, data: Prisma.ProgressionRecordUpdateInput) {
  return prisma.progressionRecord.update({ where: { id }, data });
}

export async function softDelete(id: string) {
  return prisma.progressionRecord.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Phase 17D — idempotency lookup for the progression decisioning pipeline.
 *
 * Returns the live (non-deleted) ProgressionRecord row for the given
 * `enrolmentId` + `academicYear` pair, or `null` when none exists. The
 * pair is treated as a logical unique key for decisioning purposes — the
 * decisioner upserts against this lookup so re-running a decision never
 * duplicates a record. There is no DB-level UNIQUE constraint on
 * (enrolmentId, academicYear) at this point; adding one is a future
 * schema migration.
 */
export async function findByEnrolmentAndYear(
  enrolmentId: string,
  academicYear: string,
) {
  return prisma.progressionRecord.findFirst({
    where: { enrolmentId, academicYear, deletedAt: null },
    orderBy: { id: 'asc' },
  });
}
