import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { BURSARY_FUND_SORT } from '../utils/repository-sort-allow-lists';

export interface BursaryFundFilters {
  fundType?: string;
  academicYear?: string;
}

const defaultInclude = {
  applications: {
    include: { student: { include: { person: true } } },
    orderBy: { applicationDate: 'asc' as const },
  },
} satisfies Prisma.BursaryFundInclude;

export async function list(
  filters: BursaryFundFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.BursaryFundWhereInput = {
    ...(filters.fundType && {
      fundType: filters.fundType as Prisma.BursaryFundWhereInput['fundType'],
    }),
    ...(filters.academicYear && { academicYear: filters.academicYear }),
  };

  const [data, total] = await Promise.all([
    prisma.bursaryFund.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, BURSARY_FUND_SORT, 'createdAt'),
    }),
    prisma.bursaryFund.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.bursaryFund.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.BursaryFundUncheckedCreateInput) {
  return prisma.bursaryFund.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.BursaryFundUpdateInput) {
  return prisma.bursaryFund.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

/**
 * Hard-delete a BursaryFund. The schema has no `deletedAt` column on
 * BursaryFund. Operators must ensure no `BursaryApplication` rows remain
 * attached before deletion (Prisma will reject the delete if FKs would
 * be violated since `BursaryApplication.bursaryFundId` is required).
 */
export async function remove(id: string) {
  return prisma.bursaryFund.delete({ where: { id } });
}

/**
 * Phase 1C — transaction-aware budget reservation used by the bursary
 * auto-decisioning pipeline. Increments `allocated` by `amount` and
 * decrements `remaining` by the same amount inside the caller's
 * `$transaction` so the fund's running totals stay consistent with the
 * application's flipped status. The caller is responsible for ensuring
 * `amount > 0` and `amount <= remaining` (the pure decision engine
 * enforces both before this is reached).
 */
export async function reserveBudgetInTx(
  id: string,
  amount: number,
  tx: Prisma.TransactionClient,
) {
  return tx.bursaryFund.update({
    where: { id },
    data: {
      allocated: { increment: amount },
      remaining: { decrement: amount },
    },
  });
}

/**
 * Phase 1C — transaction-aware budget release used when a previously
 * APPROVED application is later REJECTED (or vice-versa). Mirror of
 * `reserveBudgetInTx`: decrements `allocated`, increments `remaining`.
 */
export async function releaseBudgetInTx(
  id: string,
  amount: number,
  tx: Prisma.TransactionClient,
) {
  return tx.bursaryFund.update({
    where: { id },
    data: {
      allocated: { decrement: amount },
      remaining: { increment: amount },
    },
  });
}
