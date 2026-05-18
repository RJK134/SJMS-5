import prisma from '../utils/prisma';
import type { Prisma } from '@prisma/client';
import {
  type CursorPaginationParams,
  buildCursorPaginatedResponse,
  safeOrderBy,
} from '../utils/pagination';
import { HESA_VALIDATION_RULE_SORT } from '../utils/repository-sort-allow-lists';

export interface HesaValidationRuleFilters {
  entityType?: string;
  fieldName?: string;
  validationType?: string;
  severity?: string;
  isActive?: boolean;
}

export async function create(data: Prisma.HESAValidationRuleUncheckedCreateInput) {
  return prisma.hESAValidationRule.create({ data });
}

export async function getById(id: string) {
  return prisma.hESAValidationRule.findUnique({ where: { id } });
}

export async function getByCode(ruleCode: string) {
  return prisma.hESAValidationRule.findUnique({ where: { ruleCode } });
}

export async function list(
  filters: HesaValidationRuleFilters = {},
  pagination: CursorPaginationParams,
) {
  const where: Prisma.HESAValidationRuleWhereInput = {
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.fieldName && { fieldName: filters.fieldName }),
    ...(filters.validationType && { validationType: filters.validationType }),
    ...(filters.severity && {
      severity: filters.severity as Prisma.HESAValidationRuleWhereInput['severity'],
    }),
    ...(typeof filters.isActive === 'boolean' && { isActive: filters.isActive }),
  };

  const [data, total] = await Promise.all([
    prisma.hESAValidationRule.findMany({
      where,
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: safeOrderBy(pagination, HESA_VALIDATION_RULE_SORT),
    }),
    prisma.hESAValidationRule.count({ where }),
  ]);

  return buildCursorPaginatedResponse(data, total, pagination.limit);
}

export async function update(id: string, data: Prisma.HESAValidationRuleUpdateInput) {
  return prisma.hESAValidationRule.update({ where: { id }, data });
}

/**
 * Hard delete — HESAValidationRule does not declare a `deletedAt`
 * column. Operators wanting to retain a rule for audit should set
 * `isActive: false` via `update()` instead.
 */
export async function remove(id: string) {
  return prisma.hESAValidationRule.delete({ where: { id } });
}

/**
 * Returns every active validation rule. Inactive rules are filtered
 * out at the query layer so the composer never needs to re-check.
 */
export async function findAllActive() {
  return prisma.hESAValidationRule.findMany({
    where: { isActive: true },
    orderBy: [{ entityType: 'asc' }, { ruleCode: 'asc' }],
  });
}

/**
 * Returns active rules scoped to a single entity type — used when
 * the operator is composing a return for a specific entity slice.
 */
export async function findActiveByEntityType(entityType: string) {
  return prisma.hESAValidationRule.findMany({
    where: { isActive: true, entityType },
    orderBy: { ruleCode: 'asc' },
  });
}
