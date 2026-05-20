import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/sponsor.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';

export interface SponsorListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  sponsorType?: string;
  isActive?: boolean;
  name?: string;
}

export async function list(query: SponsorListQuery) {
  const { cursor, limit, sort, order, sponsorType, isActive, name } = query;
  return repo.list(
    { sponsorType, isActive, name },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('Sponsor', id);
  return result;
}

export async function create(
  data: Prisma.SponsorUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('Sponsor', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'sponsor.created',
    entityType: 'Sponsor',
    entityId: result.id,
    actorId: userId,
    data: {
      name: result.name,
      sponsorType: result.sponsorType,
      isActive: result.isActive,
      country: result.country,
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.SponsorUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('Sponsor', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'sponsor.updated',
    entityType: 'Sponsor',
    entityId: id,
    actorId: userId,
    data: {
      name: result.name,
      sponsorType: result.sponsorType,
      isActive: result.isActive,
      country: result.country,
    },
  });
  if (result.isActive !== previous.isActive) {
    emitEvent({
      event: 'sponsor.status_changed',
      entityType: 'Sponsor',
      entityId: id,
      actorId: userId,
      data: {
        previousIsActive: previous.isActive,
        newIsActive: result.isActive,
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('Sponsor', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'sponsor.deleted',
    entityType: 'Sponsor',
    entityId: id,
    actorId: userId,
    data: {
      name: previous.name,
      sponsorType: previous.sponsorType,
    },
  });
}
