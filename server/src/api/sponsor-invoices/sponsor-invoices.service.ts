import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/sponsorInvoice.repository';
import * as sponsorRepo from '../../repositories/sponsor.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface SponsorInvoiceListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  sponsorId?: string;
  sponsorAgreementId?: string;
  status?: string;
  academicYear?: string;
  invoiceNumber?: string;
}

export async function list(query: SponsorInvoiceListQuery) {
  const { cursor, limit, sort, order, ...filters } = query;
  return repo.list(filters, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('SponsorInvoice', id);
  return result;
}

export async function create(
  data: Prisma.SponsorInvoiceUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const sponsor = await sponsorRepo.getById(data.sponsorId);
  if (!sponsor) {
    throw new ValidationError(
      `Cannot create sponsor invoice: sponsor ${data.sponsorId} does not exist.`,
    );
  }
  const existing = await repo.findByInvoiceNumber(data.invoiceNumber);
  if (existing) {
    throw new ValidationError(
      `Invoice number ${data.invoiceNumber} already exists (id: ${existing.id}).`,
    );
  }
  const result = await repo.create(data);
  await logAudit('SponsorInvoice', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'sponsor_invoice.created',
    entityType: 'SponsorInvoice',
    entityId: result.id,
    actorId: userId,
    data: {
      sponsorId: result.sponsorId,
      sponsorAgreementId: result.sponsorAgreementId,
      invoiceNumber: result.invoiceNumber,
      academicYear: result.academicYear,
      amount: toNumber(result.amount as unknown as DecimalLike),
      status: result.status,
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.SponsorInvoiceUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('SponsorInvoice', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'sponsor_invoice.updated',
    entityType: 'SponsorInvoice',
    entityId: id,
    actorId: userId,
    data: {
      sponsorId: result.sponsorId,
      invoiceNumber: result.invoiceNumber,
      academicYear: result.academicYear,
      amount: toNumber(result.amount as unknown as DecimalLike),
      paidAmount: toNumber(result.paidAmount as unknown as DecimalLike),
      status: result.status,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'sponsor_invoice.status_changed',
      entityType: 'SponsorInvoice',
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
  await repo.softDelete(id);
  await logAudit('SponsorInvoice', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'sponsor_invoice.deleted',
    entityType: 'SponsorInvoice',
    entityId: id,
    actorId: userId,
    data: {
      sponsorId: previous.sponsorId,
      invoiceNumber: previous.invoiceNumber,
      academicYear: previous.academicYear,
    },
  });
}
