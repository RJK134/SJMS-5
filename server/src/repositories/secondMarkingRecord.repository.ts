import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { SECOND_MARKING_SORT } from '../utils/repository-sort-allow-lists';

// ── Workstream C3 — SecondMarkingRecord repository ───────────────────────────
//
// Wraps Prisma access to `SecondMarkingRecord`. The schema attaches a
// SecondMarkingRecord to a given (assessmentId, studentId) pair rather than
// to a specific AssessmentAttempt id; the Workstream C3 service therefore
// resolves the (assessmentId, studentId) tuple from the parent
// AssessmentAttempt via `moduleRegistration.enrolment.studentId` and uses
// these helpers to find / create / update the row.
//
// SecondMarkingRecord has no `deletedAt` column on the schema, so this
// repository is hard-delete-only. The upstream service treats the row as
// append-only in practice (we never DELETE; reconciliation flips
// `completedDate` and `agreedMark` to record the outcome).

export interface SecondMarkingRecordFilters {
  assessmentId?: string;
  studentId?: string;
  secondMarkerId?: string;
  /**
   * Derived status filter. The schema has no `status` column, so this is
   * mapped onto the existing fields:
   *   ASSIGNED_TO_SECOND — completedDate IS NULL AND agreedMark IS NULL
   *   SECOND_MARKED      — completedDate IS NULL AND agreedMark IS NULL  (same shape — see service)
   *   RECONCILED         — completedDate IS NOT NULL
   * Callers needing the SECOND_MARKED vs ASSIGNED_TO_SECOND distinction must
   * use the service layer; the repo only filters by RECONCILED via
   * completedDate presence.
   */
  reconciled?: boolean;
}

const defaultInclude = {
  assessment: { include: { module: true } },
} satisfies Prisma.SecondMarkingRecordInclude;

export async function list(
  filters: SecondMarkingRecordFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.SecondMarkingRecordWhereInput = {
    ...(filters.assessmentId && { assessmentId: filters.assessmentId }),
    ...(filters.studentId && { studentId: filters.studentId }),
    ...(filters.secondMarkerId && { secondMarkerId: filters.secondMarkerId }),
    ...(filters.reconciled === true && { completedDate: { not: null } }),
    ...(filters.reconciled === false && { completedDate: null }),
  };

  const [data, total] = await Promise.all([
    prisma.secondMarkingRecord.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, SECOND_MARKING_SORT),
    }),
    prisma.secondMarkingRecord.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.secondMarkingRecord.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.SecondMarkingRecordUncheckedCreateInput) {
  return prisma.secondMarkingRecord.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.SecondMarkingRecordUpdateInput) {
  return prisma.secondMarkingRecord.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

export async function remove(id: string) {
  return prisma.secondMarkingRecord.delete({ where: { id } });
}

/**
 * Workstream C3 helper — returns every SecondMarkingRecord linked to the
 * (assessmentId, studentId) pair derived from the parent AssessmentAttempt.
 *
 * Note: the schema's `SecondMarkingRecord` has no direct `attemptId` FK; the
 * link is logical via the (assessmentId, studentId) pair. The service layer
 * resolves studentId via the AssessmentAttempt's moduleRegistration ->
 * enrolment join and passes both ids through.
 *
 * Returns the rows in `createdAt` ascending order so the operator UI can
 * render the assignment history of an attempt deterministically.
 */
export async function findByAttempt(
  assessmentId: string,
  studentId: string,
) {
  return prisma.secondMarkingRecord.findMany({
    where: { assessmentId, studentId },
    include: defaultInclude,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Workstream C3 helper — returns every SecondMarkingRecord assigned to the
 * given marker that has not yet been reconciled (completedDate IS NULL).
 *
 * Drives the marker's "outstanding second-marking assignments" list. The
 * schema cannot distinguish "assigned but not yet recorded" from
 * "recorded but not yet reconciled" via persisted columns alone; the
 * service layer surfaces that distinction in the response payload.
 */
export async function findOpenAssignmentsForMarker(
  secondMarkerId: string,
) {
  return prisma.secondMarkingRecord.findMany({
    where: { secondMarkerId, completedDate: null },
    include: defaultInclude,
    orderBy: { createdAt: 'asc' },
  });
}
