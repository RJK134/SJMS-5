import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/bursaryApplication.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface BursaryApplicationListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  bursaryFundId?: string;
  studentId?: string;
  status?: string;
}

export async function list(query: BursaryApplicationListQuery) {
  const { cursor, limit, sort, order, bursaryFundId, studentId, status } = query;
  return repo.list(
    { bursaryFundId, studentId, status },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('BursaryApplication', id);
  return result;
}

export async function create(
  data: Prisma.BursaryApplicationUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('BursaryApplication', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'bursary_application.created',
    entityType: 'BursaryApplication',
    entityId: result.id,
    actorId: userId,
    data: {
      bursaryFundId: result.bursaryFundId,
      studentId: result.studentId,
      status: result.status,
      awardAmount:
        result.awardAmount == null
          ? null
          : toNumber(result.awardAmount as unknown as DecimalLike),
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.BursaryApplicationUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('BursaryApplication', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'bursary_application.updated',
    entityType: 'BursaryApplication',
    entityId: id,
    actorId: userId,
    data: {
      bursaryFundId: result.bursaryFundId,
      studentId: result.studentId,
      status: result.status,
      awardAmount:
        result.awardAmount == null
          ? null
          : toNumber(result.awardAmount as unknown as DecimalLike),
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'bursary_application.status_changed',
      entityType: 'BursaryApplication',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus: previous.status,
        newStatus: result.status,
        awardAmount:
          result.awardAmount == null
            ? null
            : toNumber(result.awardAmount as unknown as DecimalLike),
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.remove(id);
  await logAudit('BursaryApplication', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'bursary_application.deleted',
    entityType: 'BursaryApplication',
    entityId: id,
    actorId: userId,
    data: {
      bursaryFundId: previous.bursaryFundId,
      studentId: previous.studentId,
    },
  });
}
