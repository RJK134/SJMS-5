import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/creditNote.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface CreditNoteListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  invoiceId?: string;
}

export async function list(query: CreditNoteListQuery) {
  const { cursor, limit, sort, order, invoiceId } = query;
  return repo.list({ invoiceId }, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('CreditNote', id);
  return result;
}

export async function create(
  data: Prisma.CreditNoteUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('CreditNote', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'credit_note.created',
    entityType: 'CreditNote',
    entityId: result.id,
    actorId: userId,
    data: {
      invoiceId: result.invoiceId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      issuedDate: result.issuedDate,
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.CreditNoteUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('CreditNote', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'credit_note.updated',
    entityType: 'CreditNote',
    entityId: id,
    actorId: userId,
    data: {
      invoiceId: result.invoiceId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      issuedDate: result.issuedDate,
    },
  });
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.remove(id);
  await logAudit('CreditNote', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'credit_note.deleted',
    entityType: 'CreditNote',
    entityId: id,
    actorId: userId,
    data: {
      invoiceId: previous.invoiceId,
      amount: toNumber(previous.amount as unknown as DecimalLike),
    },
  });
}
