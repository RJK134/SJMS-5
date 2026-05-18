import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { HESA_RETURN_SORT } from '../utils/repository-sort-allow-lists';

export interface HesaReturnFilters {
  academicYear?: string;
  returnType?: string;
  status?: string;
}

const defaultInclude = {
  snapshots: true,
} satisfies Prisma.HESAReturnInclude;

export async function create(data: Prisma.HESAReturnUncheckedCreateInput) {
  return prisma.hESAReturn.create({ data });
}

export async function getById(id: string) {
  return prisma.hESAReturn.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function list(
  filters: HesaReturnFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.HESAReturnWhereInput = {
    ...(filters.academicYear && { academicYear: filters.academicYear }),
    ...(filters.returnType && {
      returnType: filters.returnType as Prisma.HESAReturnWhereInput['returnType'],
    }),
    ...(filters.status && {
      status: filters.status as Prisma.HESAReturnWhereInput['status'],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.hESAReturn.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, HESA_RETURN_SORT),
    }),
    prisma.hESAReturn.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function update(id: string, data: Prisma.HESAReturnUpdateInput) {
  return prisma.hESAReturn.update({ where: { id }, data });
}

/**
 * Hard delete — HESAReturn does not declare a `deletedAt` column, and
 * `HESASnapshot.hesaReturnId` cascades on delete, so the snapshot rows
 * are removed atomically by the FK action. Operators wanting to retain
 * a return for audit should flip `status` to REJECTED via `update()`
 * instead.
 */
export async function remove(id: string) {
  return prisma.hESAReturn.delete({ where: { id } });
}

/**
 * Idempotency lookup. Returns the most recent active (non-REJECTED)
 * HESAReturn for the (academicYear, returnType) pair, or `null` when
 * none exists. The composer routes through this so re-running a
 * compose call updates the existing return rather than creating a
 * duplicate envelope per attempt.
 */
export async function findActiveByYear(academicYear: string, returnType: string) {
  return prisma.hESAReturn.findFirst({
    where: {
      academicYear,
      returnType: returnType as Prisma.HESAReturnWhereInput['returnType'],
      status: { not: 'REJECTED' },
    },
    orderBy: { createdAt: 'desc' },
  });
}
