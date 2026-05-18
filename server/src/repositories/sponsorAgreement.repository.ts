import { type Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { SPONSOR_AGREEMENT_SORT } from '../utils/repository-sort-allow-lists';

export interface SponsorAgreementFilters {
  studentAccountId?: string;
  sponsorType?: string;
  status?: string;
  academicYear?: string;
}

const defaultInclude = {
  studentAccount: { include: { student: { include: { person: true } } } },
} satisfies Prisma.SponsorAgreementInclude;

export async function list(
  filters: SponsorAgreementFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.SponsorAgreementWhereInput = {
    ...(filters.studentAccountId && { studentAccountId: filters.studentAccountId }),
    ...(filters.sponsorType && {
      sponsorType: filters.sponsorType as Prisma.SponsorAgreementWhereInput['sponsorType'],
    }),
    ...(filters.status && { status: filters.status }),
    ...(filters.academicYear && { academicYear: filters.academicYear }),
  };

  const [data, total] = await Promise.all([
    prisma.sponsorAgreement.findMany({
      where,
      include: defaultInclude,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, SPONSOR_AGREEMENT_SORT, 'createdAt'),
    }),
    prisma.sponsorAgreement.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function getById(id: string) {
  return prisma.sponsorAgreement.findUnique({
    where: { id },
    include: defaultInclude,
  });
}

export async function create(data: Prisma.SponsorAgreementUncheckedCreateInput) {
  return prisma.sponsorAgreement.create({ data, include: defaultInclude });
}

export async function update(id: string, data: Prisma.SponsorAgreementUpdateInput) {
  return prisma.sponsorAgreement.update({
    where: { id },
    data,
    include: defaultInclude,
  });
}

/**
 * Hard-delete a SponsorAgreement. The schema has no `deletedAt` column on
 * SponsorAgreement, so removal is genuinely destructive. Operators wanting
 * a logical delete should flip `status` to a non-active value (e.g.
 * `'cancelled'`) via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.sponsorAgreement.delete({ where: { id } });
}

/**
 * Phase 18A — minimal repository helper for the fee calculation engine.
 *
 * Returns active sponsor agreements (`status === 'active'`) attached to
 * the given student's StudentAccount for the given academic year. Joined
 * through the StudentAccount.studentId + academicYear so callers do not
 * have to resolve the StudentAccount id separately. Used by the fee
 * assessor to compose the sponsor-contribution input to `calculateFee`.
 */
export async function findActiveByStudentYear(
  studentId: string,
  academicYear: string,
) {
  return prisma.sponsorAgreement.findMany({
    where: {
      academicYear,
      status: 'active',
      studentAccount: { studentId },
    },
    orderBy: { createdAt: 'asc' },
  });
}
