import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { REFUND_APPROVAL_SORT } from '../utils/repository-sort-allow-lists';

export interface RefundApprovalFilters {
  studentAccountId?: string;
  status?: string;
}

const defaultInclude = {
  studentAccount: { include: { student: { include: { person: true } } } },
} satisfies Prisma.RefundApprovalInclude;

export async function list(
  filters: RefundApprovalFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.RefundApprovalWhereInput = {
    ...(filters.studentAccountId && { studentAccountId: filters.studentAccountId }),
    ...(filters.status && {
      status: filters.status as Prisma.RefundApprovalWhereInput['status'],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.refundApproval.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, REFUND_APPROVAL_SORT, 'createdAt'),
    }),
    prisma.refundApproval.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.refundApproval.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.RefundApprovalUncheckedCreateInput) {
  return prisma.refundApproval.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.RefundApprovalUpdateInput) {
  return prisma.refundApproval.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

/**
 * Hard-delete a RefundApproval. The schema has no `deletedAt` column on
 * RefundApproval. Operators wanting a logical delete should flip
 * `status` to `REJECTED` via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.refundApproval.delete({ where: { id } });
}
