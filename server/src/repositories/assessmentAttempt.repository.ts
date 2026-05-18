import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { type CursorPaginationParams, buildCursorPaginatedResponse, safeOrderBy } from '../utils/pagination';
import { ASSESSMENT_ATTEMPT_SORT } from '../utils/repository-sort-allow-lists';

export interface AssessmentAttemptFilters {
  studentId?: string;
  assessmentId?: string;
  moduleRegistrationId?: string;
  attemptNumber?: number;
  status?: string;
}

export async function list(filters: AssessmentAttemptFilters = {}, pagination: CursorPaginationParams) {
  const where: Prisma.AssessmentAttemptWhereInput = {
    deletedAt: null,
    ...(filters.studentId && { moduleRegistration: { enrolment: { studentId: filters.studentId } } }),
    ...(filters.assessmentId && { assessmentId: filters.assessmentId }),
    ...(filters.moduleRegistrationId && { moduleRegistrationId: filters.moduleRegistrationId }),
    ...(filters.attemptNumber !== undefined && { attemptNumber: filters.attemptNumber }),
    ...(filters.status && { status: filters.status as any }),
  };

  const [data, total] = await Promise.all([
    prisma.assessmentAttempt.findMany({
      where,
      include: {
        assessment: { include: { module: true } },
        moduleRegistration: {
          include: { enrolment: { include: { student: { include: { person: true } } } } },
        },
      },
      take: pagination.limit + 1, ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, ASSESSMENT_ATTEMPT_SORT),
    }),
    prisma.assessmentAttempt.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.assessmentAttempt.findFirst({
    where: { id, deletedAt: null },
    include: {
      assessment: { include: { module: true } },
      moduleRegistration: {
        include: { enrolment: { include: { student: { include: { person: true } } } } },
      },
    },
  });
}

export async function create(data: Prisma.AssessmentAttemptUncheckedCreateInput) {
  return prisma.assessmentAttempt.create({ data });
}

export async function update(id: string, data: Prisma.AssessmentAttemptUpdateInput) {
  return prisma.assessmentAttempt.update({ where: { id }, data });
}

export async function softDelete(id: string) {
  return prisma.assessmentAttempt.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Phase 17B — cross-entity guard helper.
 *
 * Returns the number of non-deleted AssessmentAttempt rows for the given
 * moduleRegistrationId whose status is anything other than CONFIRMED.
 * The ModuleResult cascade uses this to refuse PROVISIONAL → CONFIRMED
 * transitions while attempts remain open.
 *
 * Returning a count (not a list) keeps the helper cheap on hot paths and
 * avoids dragging the include tree through unnecessary joins.
 */
export async function countNonConfirmedByModuleRegistration(
  moduleRegistrationId: string,
): Promise<number> {
  return prisma.assessmentAttempt.count({
    where: {
      moduleRegistrationId,
      deletedAt: null,
      status: { not: 'CONFIRMED' as Prisma.AssessmentAttemptWhereInput['status'] },
    },
  });
}

/**
 * Phase 17A — projection helper for marks aggregation.
 *
 * Returns the minimum shape needed by `utils/marks-aggregation` for every
 * non-deleted AssessmentAttempt under the given moduleRegistrationId, plus
 * its parent assessment's `weighting` and `maxMark`. The optional `status`
 * filter lets the caller restrict to CONFIRMED rows when computing a
 * post-board aggregate, or include MARKED / MODERATED rows when previewing
 * a pre-board aggregate.
 *
 * Returning a flat projection (rather than the full include tree from
 * `getById` / `list`) keeps the aggregation hot path cheap — the include
 * tree carries enrolment + student + person joins that aggregation does
 * not need.
 */
export async function findForAggregation(
  moduleRegistrationId: string,
  options: { statuses?: ReadonlyArray<string> } = {},
): Promise<
  Array<{
    id: string;
    assessmentId: string;
    finalMark: number | null;
    maxMark: number;
    weighting: number;
    status: string;
  }>
> {
  const where: Prisma.AssessmentAttemptWhereInput = {
    moduleRegistrationId,
    deletedAt: null,
    ...(options.statuses && options.statuses.length > 0
      ? {
          status: {
            in: options.statuses as unknown as Prisma.AssessmentAttemptWhereInput['status'][],
          } as Prisma.AssessmentAttemptWhereInput['status'],
        }
      : {}),
  };

  const rows = await prisma.assessmentAttempt.findMany({
    where,
    select: {
      id: true,
      assessmentId: true,
      finalMark: true,
      status: true,
      assessment: { select: { weighting: true, maxMark: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    assessmentId: r.assessmentId,
    finalMark: r.finalMark != null ? Number(r.finalMark) : null,
    maxMark: r.assessment?.maxMark != null ? Number(r.assessment.maxMark) : 0,
    weighting: r.assessment?.weighting ?? 0,
    status: r.status as unknown as string,
  }));
}
