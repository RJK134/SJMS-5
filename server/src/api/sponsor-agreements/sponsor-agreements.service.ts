import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/sponsorAgreement.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface SponsorAgreementListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  sponsorType?: string;
  status?: string;
  academicYear?: string;
}

export async function list(query: SponsorAgreementListQuery) {
  const { cursor, limit, sort, order, studentAccountId, sponsorType, status, academicYear } = query;
  return repo.list(
    { studentAccountId, sponsorType, status, academicYear },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('SponsorAgreement', id);
  return result;
}

export async function create(
  data: Prisma.SponsorAgreementUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('SponsorAgreement', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'sponsor_agreement.created',
    entityType: 'SponsorAgreement',
    entityId: result.id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      sponsorName: result.sponsorName,
      sponsorType: result.sponsorType,
      academicYear: result.academicYear,
      amountAgreed: toNumber(result.amountAgreed as unknown as DecimalLike),
      status: result.status,
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.SponsorAgreementUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('SponsorAgreement', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'sponsor_agreement.updated',
    entityType: 'SponsorAgreement',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      sponsorName: result.sponsorName,
      sponsorType: result.sponsorType,
      academicYear: result.academicYear,
      amountAgreed: toNumber(result.amountAgreed as unknown as DecimalLike),
      amountReceived: toNumber(result.amountReceived as unknown as DecimalLike),
      status: result.status,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'sponsor_agreement.status_changed',
      entityType: 'SponsorAgreement',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus: previous.status,
        newStatus: result.status,
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.remove(id);
  await logAudit('SponsorAgreement', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'sponsor_agreement.deleted',
    entityType: 'SponsorAgreement',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: previous.studentAccountId,
      sponsorName: previous.sponsorName,
      academicYear: previous.academicYear,
    },
  });
}
