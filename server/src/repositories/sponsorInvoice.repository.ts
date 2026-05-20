import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { SPONSOR_INVOICE_SORT } from '../utils/repository-sort-allow-lists';

export interface SponsorInvoiceFilters {
  sponsorId?: string;
  sponsorAgreementId?: string;
  status?: string;
  academicYear?: string;
  invoiceNumber?: string;
}

const defaultInclude = {
  sponsor: true,
  sponsorAgreement: {
    include: {
      studentAccount: { include: { student: { include: { person: true } } } },
    },
  },
} satisfies Prisma.SponsorInvoiceInclude;

export async function list(
  filters: SponsorInvoiceFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.SponsorInvoiceWhereInput = {
    deletedAt: null,
    ...(filters.sponsorId && { sponsorId: filters.sponsorId }),
    ...(filters.sponsorAgreementId && { sponsorAgreementId: filters.sponsorAgreementId }),
    ...(filters.status && {
      status: filters.status as Prisma.SponsorInvoiceWhereInput['status'],
    }),
    ...(filters.academicYear && { academicYear: filters.academicYear }),
    ...(filters.invoiceNumber && { invoiceNumber: filters.invoiceNumber }),
  };

  const [data, total] = await Promise.all([
    prisma.sponsorInvoice.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, SPONSOR_INVOICE_SORT, 'issueDate'),
    }),
    prisma.sponsorInvoice.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.sponsorInvoice.findFirst({
    where: { id, deletedAt: null },
    include: defaultInclude,
  });
}

export async function findByInvoiceNumber(invoiceNumber: string) {
  return prisma.sponsorInvoice.findFirst({
    where: { invoiceNumber, deletedAt: null },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.SponsorInvoiceUncheckedCreateInput) {
  return prisma.sponsorInvoice.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.SponsorInvoiceUpdateInput) {
  return prisma.sponsorInvoice.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

export async function softDelete(id: string) {
  return prisma.sponsorInvoice.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
