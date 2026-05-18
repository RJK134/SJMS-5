import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { HESA_SNAPSHOT_SORT } from '../utils/repository-sort-allow-lists';

export interface HesaSnapshotFilters {
  hesaReturnId?: string;
  entityType?: string;
  entityId?: string;
}

export async function create(data: Prisma.HESASnapshotUncheckedCreateInput) {
  return prisma.hESASnapshot.create({ data });
}

export async function getById(id: string) {
  return prisma.hESASnapshot.findUnique({ where: { id } });
}

export async function list(
  filters: HesaSnapshotFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.HESASnapshotWhereInput = {
    ...(filters.hesaReturnId && { hesaReturnId: filters.hesaReturnId }),
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId && { entityId: filters.entityId }),
  };

  const [data, total] = await Promise.all([
    prisma.hESASnapshot.findMany({
      where,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, HESA_SNAPSHOT_SORT),
    }),
    prisma.hESASnapshot.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

/**
 * Atomically replace every snapshot for a HESAReturn. The composer
 * regenerates the entire body on each compose call (snapshots are
 * conceptually a point-in-time projection of the cohort), so the
 * pre-existing rows are deleted and the new set inserted within
 * a single Prisma transaction. Returns the inserted row count.
 */
export async function replaceForReturn(
  hesaReturnId: string,
  rows: Array<Omit<Prisma.HESASnapshotUncheckedCreateInput, 'hesaReturnId'>>,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.hESASnapshot.deleteMany({ where: { hesaReturnId } });
    if (rows.length === 0) return 0;
    const created = await tx.hESASnapshot.createMany({
      data: rows.map((r) => ({ ...r, hesaReturnId })),
    });
    return created.count;
  });
}

export async function findByReturnId(hesaReturnId: string) {
  return prisma.hESASnapshot.findMany({
    where: { hesaReturnId },
    orderBy: { snapshotDate: 'desc' },
  });
}
