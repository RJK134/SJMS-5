import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { ANONYMOUS_MARKING_SORT } from '../utils/repository-sort-allow-lists';

// ── Workstream C3 — AnonymousMarking repository ──────────────────────────────
//
// Wraps Prisma access to `AnonymousMarking`. The schema attaches an
// AnonymousMarking row to a (assessmentId, studentId) pair, identifying the
// candidate in marker-facing views by the `anonymousId` instead of the real
// studentId. There is no `deletedAt` column — once anonymised, the record is
// append-only.  Reveal flips `revealed` to true and stamps `revealedDate`;
// it is one-way (an anonymisation cannot be un-revealed once disclosure has
// been recorded), to preserve the integrity of the audit trail.
//
// Note: the schema has no `revealedBy` column at the time of writing; the
// service layer captures that information in the AuditLog row and the
// emitted webhook payload rather than persisting a dedicated column. This
// keeps the change set inside Workstream C3 backend-only with no schema
// migration (per the briefing's "use a sensible default" guidance).

export interface AnonymousMarkingFilters {
  assessmentId?: string;
  studentId?: string;
  /** Filter by reveal status (true = revealed, false = still anonymised). */
  revealed?: boolean;
}

const defaultInclude = {
  assessment: { include: { module: true } },
} satisfies Prisma.AnonymousMarkingInclude;

export async function list(
  filters: AnonymousMarkingFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.AnonymousMarkingWhereInput = {
    ...(filters.assessmentId && { assessmentId: filters.assessmentId }),
    ...(filters.studentId && { studentId: filters.studentId }),
    ...(filters.revealed !== undefined && { revealed: filters.revealed }),
  };

  const [data, total] = await Promise.all([
    prisma.anonymousMarking.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, ANONYMOUS_MARKING_SORT),
    }),
    prisma.anonymousMarking.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.anonymousMarking.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.AnonymousMarkingUncheckedCreateInput) {
  return prisma.anonymousMarking.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.AnonymousMarkingUpdateInput) {
  return prisma.anonymousMarking.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

export async function remove(id: string) {
  return prisma.anonymousMarking.delete({ where: { id } });
}

/**
 * Workstream C3 helper — returns every AnonymousMarking linked to the
 * (assessmentId, studentId) pair derived from the parent AssessmentAttempt.
 *
 * Used to detect a "double-anonymise" attempt before issuing a fresh
 * anonymousId, and to render the candidate's reveal history in operator
 * UIs. Rows are returned in `createdAt` ascending order.
 */
export async function findByAttempt(
  assessmentId: string,
  studentId: string,
) {
  return prisma.anonymousMarking.findMany({
    where: { assessmentId, studentId },
    include: defaultInclude,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Workstream C3 helper — flips an AnonymousMarking row to `revealed: true`
 * and stamps `revealedDate`. Append-only: the row is not deleted.
 *
 * The schema has no `revealedBy` column; the caller (the service layer)
 * persists the revealing user via `updatedBy` and through the AuditLog +
 * webhook payload. Returning the updated row keeps the service-layer
 * contract self-contained.
 */
export async function revealMarker(id: string, userId: string) {
  return prisma.anonymousMarking.update({
    where: { id },
    data: {
      revealed: true,
      revealedDate: new Date(),
      updatedBy: userId,
    },
    include: defaultInclude,
  });
}
