import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { type CursorPaginationParams, buildCursorPaginatedResponse, safeOrderBy } from '../utils/pagination';
import { MODULE_RESULT_SORT } from '../utils/repository-sort-allow-lists';

export interface ModuleResultFilters {
  moduleId?: string;
  moduleRegistrationId?: string;
  academicYear?: string;
  outcome?: string;
}

export async function list(filters: ModuleResultFilters = {}, pagination: CursorPaginationParams) {
  const where: Prisma.ModuleResultWhereInput = {
    deletedAt: null,
    ...(filters.moduleId && { moduleId: filters.moduleId }),
    ...(filters.moduleRegistrationId && { moduleRegistrationId: filters.moduleRegistrationId }),
    ...(filters.academicYear && { academicYear: filters.academicYear }),
    ...(filters.outcome && { outcome: filters.outcome as any }),
  };

  const [data, total] = await Promise.all([
    prisma.moduleResult.findMany({
      where,
      include: { moduleRegistration: { include: { module: true, enrolment: { include: { student: { include: { person: true } } } } } }, module: true },
      take: pagination.limit + 1, ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, MODULE_RESULT_SORT),
    }),
    prisma.moduleResult.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.moduleResult.findFirst({
    where: { id, deletedAt: null },
    include: {
      moduleRegistration: {
        include: { enrolment: { include: { student: { include: { person: true } } } } },
      },
      module: true,
    },
  });
}

export async function create(data: Prisma.ModuleResultUncheckedCreateInput) {
  return prisma.moduleResult.create({ data });
}

export async function update(id: string, data: Prisma.ModuleResultUpdateInput) {
  return prisma.moduleResult.update({ where: { id }, data });
}

export async function softDelete(id: string) {
  return prisma.moduleResult.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Phase 17A — idempotency lookup for the marks aggregation pipeline.
 *
 * Returns the live (non-deleted) ModuleResult row for the given
 * `moduleRegistrationId` + `academicYear` pair, or `null` when none exists.
 * The pair is treated as a logical unique key for aggregation purposes:
 * the marks aggregator upserts against this lookup so re-running an
 * aggregation never duplicates a result row.
 *
 * Note: there is no DB-level UNIQUE constraint on (moduleRegistrationId,
 * academicYear) at this point — adding one is a 17B/17C decision that
 * touches the schema. Until then, this helper is the single source of
 * truth for "do I already have a ModuleResult for this aggregation?".
 */
export async function findByModuleRegistrationAndYear(
  moduleRegistrationId: string,
  academicYear: string,
) {
  return prisma.moduleResult.findFirst({
    where: { moduleRegistrationId, academicYear, deletedAt: null },
    orderBy: { id: 'asc' },
  });
}

/**
 * Phase 17D — projection for progression decisioning.
 *
 * Returns every non-deleted ModuleResult row for a given enrolment and
 * academic year, joined with the parent Module's `credits` and `level` so
 * the progression decisioner can credit-account without a second fetch.
 * The returned shape matches the `ModuleResultForProgression` interface in
 * `utils/progression-decision`. Restricting by enrolment goes through the
 * `moduleRegistration.enrolmentId` join because ModuleResult has no
 * direct enrolmentId column.
 */
export async function findForEnrolmentYear(
  enrolmentId: string,
  academicYear: string,
): Promise<
  Array<{
    id: string;
    moduleId: string;
    credits: number;
    level: number;
    aggregateMark: number | null;
    grade: string | null;
    status: string;
  }>
> {
  const rows = await prisma.moduleResult.findMany({
    where: {
      academicYear,
      deletedAt: null,
      moduleRegistration: { enrolmentId, deletedAt: null },
    },
    select: {
      id: true,
      moduleId: true,
      aggregateMark: true,
      grade: true,
      status: true,
      module: { select: { credits: true, level: true } },
    },
    orderBy: { moduleId: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    credits: r.module?.credits ?? 0,
    level: r.module?.level ?? 0,
    aggregateMark: r.aggregateMark != null ? Number(r.aggregateMark) : null,
    grade: r.grade,
    status: r.status as unknown as string,
  }));
}

/**
 * Phase 17D — projection for award classification.
 *
 * Returns every non-deleted ModuleResult row for an enrolment regardless of
 * academic year, joined with `module.credits` and `module.level`. Used by
 * `awards.service::classifyForEnrolment` to load the full body of results
 * for the final-award calculation. Status filter restricts to `CONFIRMED`
 * by default — only ratified results count toward an award classification.
 */
export async function findForEnrolment(
  enrolmentId: string,
  options: { statuses?: ReadonlyArray<string> } = {},
): Promise<
  Array<{
    id: string;
    moduleId: string;
    credits: number;
    level: number;
    aggregateMark: number | null;
    grade: string | null;
    status: string;
    academicYear: string;
  }>
> {
  const statuses = options.statuses ?? ['CONFIRMED'];
  const rows = await prisma.moduleResult.findMany({
    where: {
      deletedAt: null,
      moduleRegistration: { enrolmentId, deletedAt: null },
      status: {
        in: statuses as unknown as Prisma.ModuleResultWhereInput['status'][],
      } as Prisma.ModuleResultWhereInput['status'],
    },
    select: {
      id: true,
      moduleId: true,
      aggregateMark: true,
      grade: true,
      status: true,
      academicYear: true,
      module: { select: { credits: true, level: true } },
    },
    orderBy: [{ academicYear: 'asc' }, { moduleId: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    credits: r.module?.credits ?? 0,
    level: r.module?.level ?? 0,
    aggregateMark: r.aggregateMark != null ? Number(r.aggregateMark) : null,
    grade: r.grade,
    status: r.status as unknown as string,
    academicYear: r.academicYear,
  }));
}
