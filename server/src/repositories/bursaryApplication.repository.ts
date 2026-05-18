import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { BURSARY_APPLICATION_SORT } from '../utils/repository-sort-allow-lists';

export interface BursaryApplicationFilters {
  bursaryFundId?: string;
  studentId?: string;
  status?: string;
}

const defaultInclude = {
  bursaryFund: true,
  student: { include: { person: true } },
} satisfies Prisma.BursaryApplicationInclude;

export async function list(
  filters: BursaryApplicationFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.BursaryApplicationWhereInput = {
    ...(filters.bursaryFundId && { bursaryFundId: filters.bursaryFundId }),
    ...(filters.studentId && { studentId: filters.studentId }),
    ...(filters.status && {
      status: filters.status as Prisma.BursaryApplicationWhereInput['status'],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.bursaryApplication.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, BURSARY_APPLICATION_SORT, 'applicationDate'),
    }),
    prisma.bursaryApplication.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.bursaryApplication.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.BursaryApplicationUncheckedCreateInput) {
  return prisma.bursaryApplication.create({ data, include: defaultInclude });
}

export async function update(
  id: string,
  data: Prisma.BursaryApplicationUpdateInput,
) {
  return prisma.bursaryApplication.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

/**
 * Hard-delete a BursaryApplication. The schema has no `deletedAt` column on
 * BursaryApplication. Operators wanting a logical delete should flip
 * `status` to `REJECTED` via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.bursaryApplication.delete({ where: { id } });
}

/**
 * Phase 18A — minimal repository helper for the fee calculation engine.
 *
 * Returns awarded BursaryApplication rows for a student in a given
 * academic year. "Awarded" means status `APPROVED` or `PAID` — both
 * states have a confirmed `awardAmount` that should reduce the fee.
 * `SUBMITTED`, `UNDER_REVIEW` and `REJECTED` rows are excluded.
 */
export async function findAwardedByStudent(
  studentId: string,
  academicYear: string,
) {
  return prisma.bursaryApplication.findMany({
    where: {
      studentId,
      status: { in: ['APPROVED', 'PAID'] },
      bursaryFund: { academicYear },
    },
    include: { bursaryFund: true },
    orderBy: { applicationDate: 'asc' },
  });
}
