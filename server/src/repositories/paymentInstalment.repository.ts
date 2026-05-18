import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { PAYMENT_INSTALMENT_SORT } from '../utils/repository-sort-allow-lists';

export interface PaymentInstalmentFilters {
  paymentPlanId?: string;
  status?: string;
}

const defaultInclude = {
  paymentPlan: {
    include: {
      studentAccount: { include: { student: { include: { person: true } } } },
    },
  },
} satisfies Prisma.PaymentInstalmentInclude;

export async function list(
  filters: PaymentInstalmentFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.PaymentInstalmentWhereInput = {
    ...(filters.paymentPlanId && { paymentPlanId: filters.paymentPlanId }),
    ...(filters.status && { status: filters.status as Prisma.PaymentInstalmentWhereInput['status'] }),
  };

  const [data, total] = await Promise.all([
    prisma.paymentInstalment.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, PAYMENT_INSTALMENT_SORT, 'dueDate'),
    }),
    prisma.paymentInstalment.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.paymentInstalment.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function findByPlan(paymentPlanId: string) {
  return prisma.paymentInstalment.findMany({
    where: { paymentPlanId },
    include: defaultInclude,
    orderBy: { instalmentNum: 'asc' },
  });
}

/**
 * Find every PENDING PaymentInstalment whose dueDate is on or before
 * `asOf`. Used by future scheduled jobs (Phase 20 n8n) to issue
 * ChargeLines for instalments coming due. Returned projection is
 * the full include tree so the operator UI can render a chase list.
 */
export async function findOverdue(asOf: Date) {
  return prisma.paymentInstalment.findMany({
    where: {
      status: 'PENDING',
      dueDate: { lte: asOf },
    },
    include: defaultInclude,
    orderBy: [{ dueDate: 'asc' }, { instalmentNum: 'asc' }],
  });
}

export async function create(data: Prisma.PaymentInstalmentUncheckedCreateInput) {
  return prisma.paymentInstalment.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.PaymentInstalmentUpdateInput) {
  return prisma.paymentInstalment.update({ where: { id }, data, include: defaultInclude });
}

/**
 * Hard-delete a PaymentInstalment. The schema has no `deletedAt` on
 * PaymentInstalment, and the parent PaymentPlan cascade-deletes the
 * row when the plan itself is removed. Operators who want a logical-
 * delete should flip `status` via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.paymentInstalment.delete({ where: { id } });
}
