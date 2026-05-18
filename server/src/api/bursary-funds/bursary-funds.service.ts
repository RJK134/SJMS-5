import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/bursaryFund.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface BursaryFundListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  fundType?: string;
  academicYear?: string;
}

export async function list(query: BursaryFundListQuery) {
  const { cursor, limit, sort, order, fundType, academicYear } = query;
  return repo.list({ fundType, academicYear }, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('BursaryFund', id);
  return result;
}

export async function create(
  data: Prisma.BursaryFundUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('BursaryFund', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'bursary_fund.created',
    entityType: 'BursaryFund',
    entityId: result.id,
    actorId: userId,
    data: {
      fundName: result.fundName,
      fundType: result.fundType,
      academicYear: result.academicYear,
      totalBudget: toNumber(result.totalBudget as unknown as DecimalLike),
      remaining: toNumber(result.remaining as unknown as DecimalLike),
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.BursaryFundUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('BursaryFund', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'bursary_fund.updated',
    entityType: 'BursaryFund',
    entityId: id,
    actorId: userId,
    data: {
      fundName: result.fundName,
      fundType: result.fundType,
      academicYear: result.academicYear,
      totalBudget: toNumber(result.totalBudget as unknown as DecimalLike),
      allocated: toNumber(result.allocated as unknown as DecimalLike),
      remaining: toNumber(result.remaining as unknown as DecimalLike),
    },
  });
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.remove(id);
  await logAudit('BursaryFund', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'bursary_fund.deleted',
    entityType: 'BursaryFund',
    entityId: id,
    actorId: userId,
    data: {
      fundName: previous.fundName,
      academicYear: previous.academicYear,
    },
  });
}
