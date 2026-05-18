import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { PAYMENT_SORT } from '../utils/repository-sort-allow-lists';

export interface PaymentFilters {
  studentAccountId?: string;
  invoiceId?: string;
  status?: string;
  paymentMethod?: string;
}

const defaultInclude = {
  studentAccount: { include: { student: { include: { person: true } } } },
  invoice: true,
} satisfies Prisma.PaymentInclude;

export async function list(
  filters: PaymentFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.PaymentWhereInput = {
    deletedAt: null,
    ...(filters.studentAccountId && { studentAccountId: filters.studentAccountId }),
    ...(filters.invoiceId && { invoiceId: filters.invoiceId }),
    ...(filters.status && { status: filters.status as Prisma.PaymentWhereInput['status'] }),
    ...(filters.paymentMethod && { paymentMethod: filters.paymentMethod as Prisma.PaymentWhereInput['paymentMethod'] }),
  };

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, PAYMENT_SORT, 'transactionDate'),
    }),
    prisma.payment.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.payment.findFirst({
    where: { id, deletedAt: null },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.PaymentUncheckedCreateInput) {
  return prisma.payment.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.PaymentUpdateInput) {
  return prisma.payment.update({ where: { id }, data, include: defaultInclude });
}

export async function softDelete(id: string) {
  return prisma.payment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Atomically stamp `allocatedAt` on a Payment inside a transaction.
 *
 * @param conditional - When `true` (default), only updates rows where
 *   `allocatedAt IS NULL`.  This acts as a distributed lock for
 *   concurrent allocation requests: only the first to commit will
 *   get `count: 1`; subsequent concurrent transactions will get
 *   `count: 0` once the first has committed.  When `false`
 *   (force-mode re-allocation), the update is unconditional and
 *   always refreshes the timestamp.
 */
export async function stampAllocatedAtInTx(
  id: string,
  tx: Prisma.TransactionClient,
  conditional: boolean = true,
): Promise<{ count: number }> {
  return tx.payment.updateMany({
    where: {
      id,
      deletedAt: null,
      ...(conditional ? { allocatedAt: null } : {}),
    },
    data: { allocatedAt: new Date() },
  });
}
