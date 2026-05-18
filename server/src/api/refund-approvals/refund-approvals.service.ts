import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/refundApproval.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface RefundApprovalListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  status?: string;
}

export async function list(query: RefundApprovalListQuery) {
  const { cursor, limit, sort, order, studentAccountId, status } = query;
  return repo.list({ studentAccountId, status }, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('RefundApproval', id);
  return result;
}

export async function create(
  data: Prisma.RefundApprovalUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('RefundApproval', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'refund_approval.created',
    entityType: 'RefundApproval',
    entityId: result.id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      status: result.status,
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.RefundApprovalUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('RefundApproval', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'refund_approval.updated',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      status: result.status,
      approvedDate: result.approvedDate,
      processedDate: result.processedDate,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'refund_approval.status_changed',
      entityType: 'RefundApproval',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus: previous.status,
        newStatus: result.status,
        amount: toNumber(result.amount as unknown as DecimalLike),
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.remove(id);
  await logAudit('RefundApproval', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'refund_approval.deleted',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: previous.studentAccountId,
      amount: toNumber(previous.amount as unknown as DecimalLike),
    },
  });
}
