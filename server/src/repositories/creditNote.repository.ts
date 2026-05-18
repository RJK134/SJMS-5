import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { CREDIT_NOTE_SORT } from '../utils/repository-sort-allow-lists';

export interface CreditNoteFilters {
  invoiceId?: string;
}

const defaultInclude = {
  invoice: {
    include: {
      studentAccount: { include: { student: { include: { person: true } } } },
    },
  },
} satisfies Prisma.CreditNoteInclude;

export async function list(
  filters: CreditNoteFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.CreditNoteWhereInput = {
    ...(filters.invoiceId && { invoiceId: filters.invoiceId }),
  };

  const [data, total] = await Promise.all([
    prisma.creditNote.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, CREDIT_NOTE_SORT, 'issuedDate'),
    }),
    prisma.creditNote.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.creditNote.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.CreditNoteUncheckedCreateInput) {
  return prisma.creditNote.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.CreditNoteUpdateInput) {
  return prisma.creditNote.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

/**
 * Hard-delete a CreditNote. The schema has no `deletedAt` column on
 * CreditNote — credit notes are statutory finance records. Deletion is
 * SUPER_ADMIN-only and should be reserved for genuine data-entry errors;
 * the typical operator flow is to issue a counter credit-note rather
 * than retroactively removing one.
 */
export async function remove(id: string) {
  return prisma.creditNote.delete({ where: { id } });
}
