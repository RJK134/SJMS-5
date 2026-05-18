import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { FEE_ASSESSMENT_SORT } from '../utils/repository-sort-allow-lists';

export interface FeeAssessmentFilters {
  enrolmentId?: string;
  feeStatus?: string;
}

const defaultInclude = {
  enrolment: {
    include: {
      student: { include: { person: true } },
      programme: true,
    },
  },
} satisfies Prisma.FeeAssessmentInclude;

export async function list(
  filters: FeeAssessmentFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.FeeAssessmentWhereInput = {
    ...(filters.enrolmentId && { enrolmentId: filters.enrolmentId }),
    ...(filters.feeStatus && { feeStatus: filters.feeStatus as Prisma.FeeAssessmentWhereInput['feeStatus'] }),
  };

  const [data, total] = await Promise.all([
    prisma.feeAssessment.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, FEE_ASSESSMENT_SORT),
    }),
    prisma.feeAssessment.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.feeAssessment.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.FeeAssessmentUncheckedCreateInput) {
  return prisma.feeAssessment.create({ data });
}

export async function update(id: string, data: Prisma.FeeAssessmentUpdateInput) {
  return prisma.feeAssessment.update({ where: { id }, data });
}

/**
 * Phase 18A — idempotency lookup for the fee calculation pipeline.
 *
 * Returns the most recent FeeAssessment for the given enrolment, or
 * `null` when none exists. The fee assessor upserts against this lookup
 * so re-running an assessment for an enrolment updates the existing
 * record rather than creating a duplicate. There is no DB-level UNIQUE
 * constraint on (enrolmentId) since multiple historical assessments may
 * exist intentionally — operators wanting a brand-new historical record
 * pass `force: true` on the persist path.
 */
export async function findLatestByEnrolment(enrolmentId: string) {
  return prisma.feeAssessment.findFirst({
    where: { enrolmentId },
    orderBy: { assessedDate: 'desc' },
  });
}
