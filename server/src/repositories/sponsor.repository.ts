import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { SPONSOR_SORT } from '../utils/repository-sort-allow-lists';

export interface SponsorFilters {
  sponsorType?: string;
  isActive?: boolean;
  name?: string;
}

const defaultInclude = {
  _count: { select: { agreements: true, invoices: true } },
} satisfies Prisma.SponsorInclude;

export async function list(
  filters: SponsorFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.SponsorWhereInput = {
    deletedAt: null,
    ...(filters.sponsorType && {
      sponsorType: filters.sponsorType as Prisma.SponsorWhereInput['sponsorType'],
    }),
    ...(typeof filters.isActive === 'boolean' && { isActive: filters.isActive }),
    ...(filters.name && { name: { contains: filters.name, mode: 'insensitive' } }),
  };

  const [data, total] = await Promise.all([
    prisma.sponsor.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, SPONSOR_SORT, 'name'),
    }),
    prisma.sponsor.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.sponsor.findFirst({
    where: { id, deletedAt: null },
    include: defaultInclude,
  });
}

export async function findByName(name: string) {
  return prisma.sponsor.findFirst({
    where: { name, deletedAt: null },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.SponsorUncheckedCreateInput) {
  return prisma.sponsor.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.SponsorUpdateInput) {
  return prisma.sponsor.update({ where: { id }, data, include: defaultInclude });
}

export async function softDelete(id: string) {
  return prisma.sponsor.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
}
