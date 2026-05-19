import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/refundApproval.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

export interface RefundApprovalListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  status?: string;
}

// ── State machine ─────────────────────────────────────────────────────────
//
// Phase 1D (batch 1D, closes KI-S5-001 refund leg) wires the two-step
// separation-of-duties workflow:
//
//   REQUESTED  ──approve──▶ APPROVED ──process──▶ PROCESSED
//        │
//        └─── reject ──▶ REJECTED   (terminal)
//
// * `create()` writes a row at REQUESTED. REGISTRY proposes.
// * `approve()` moves REQUESTED → APPROVED. FINANCE only. The acting
//   FINANCE user must NOT be the proposer (segregation of duties).
// * `reject()` moves REQUESTED → REJECTED. FINANCE only.
// * `process()` moves APPROVED → PROCESSED. FINANCE only.
//
// Generic `update()` keeps the metadata-edit path (e.g. correcting `reason`
// before approval) but the router restricts it to SUPER_ADMIN so a FINANCE
// user cannot back-door an approval by PATCH-ing `status`.
//
// All transitions emit `refund_approval.<transition>` events alongside the
// existing `refund_approval.status_changed` envelope so downstream workflows
// (n8n / outbox consumers) can subscribe to the semantic transition without
// pattern-matching on previousStatus + newStatus pairs.
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSED'],
  PROCESSED: [],
  REJECTED: [],
};

function assertTransition(from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    throw new ValidationError(`Unknown refund status '${from}'`, {
      status: [`Unknown source status '${from}'`],
    });
  }
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Invalid refund transition ${from} → ${to}`,
      { status: [`Refund in status '${from}' cannot move to '${to}'`] },
    );
  }
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
  // The propose action always opens at REQUESTED — guard against a REGISTRY
  // user smuggling status=APPROVED in the create payload.
  const cleaned: Prisma.RefundApprovalUncheckedCreateInput = {
    ...data,
    status: 'REQUESTED',
    approvedBy: null,
    approvedDate: null,
    processedDate: null,
    createdBy: userId,
  };
  const result = await repo.create(cleaned);
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
  // Semantic transition event for downstream subscribers that only care about
  // the proposal step (separate from the lifecycle `created` envelope).
  emitEvent({
    event: 'refund_approval.proposed',
    entityType: 'RefundApproval',
    entityId: result.id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount: toNumber(result.amount as unknown as DecimalLike),
      proposedBy: userId,
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
  const result = await repo.update(id, { ...data, updatedBy: userId });
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

// ── Two-step workflow methods ─────────────────────────────────────────────

export async function approve(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  assertTransition(previous.status, 'APPROVED');
  // Segregation of duties: the FINANCE user approving cannot be the same
  // REGISTRY user who proposed the refund. This is the single load-bearing
  // anti-fraud control in the refund pipeline.
  if (previous.createdBy && previous.createdBy === userId) {
    throw new ForbiddenError(
      'Refund proposer cannot also approve — segregation of duties violated',
    );
  }
  const result = await repo.update(id, {
    status: 'APPROVED',
    approvedBy: userId,
    approvedDate: new Date(),
    updatedBy: userId,
  });
  await logAudit('RefundApproval', id, 'UPDATE', userId, previous, result, req);
  const amount = toNumber(result.amount as unknown as DecimalLike);
  emitEvent({
    event: 'refund_approval.updated',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      status: result.status,
      approvedDate: result.approvedDate,
      processedDate: result.processedDate,
    },
  });
  emitEvent({
    event: 'refund_approval.status_changed',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: { previousStatus: previous.status, newStatus: result.status, amount },
  });
  emitEvent({
    event: 'refund_approval.approved',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      approvedBy: userId,
      approvedDate: result.approvedDate,
      proposedBy: previous.createdBy ?? null,
    },
  });
  return result;
}

export async function reject(
  id: string,
  userId: string,
  reason: string | undefined,
  req: Request,
) {
  const previous = await getById(id);
  assertTransition(previous.status, 'REJECTED');
  const result = await repo.update(id, {
    status: 'REJECTED',
    // Capture the rejector in approvedBy (the column doubles as
    // "last finance decision-maker"); approvedDate stays null so reporting
    // can distinguish accepted from rejected timelines.
    approvedBy: userId,
    // Append the rejection reason to the existing reason field (Text) so the
    // audit trail captures both proposer rationale and rejector rationale.
    ...(reason
      ? { reason: `${previous.reason}\n\n[REJECTED by ${userId}]: ${reason}` }
      : {}),
    updatedBy: userId,
  });
  await logAudit('RefundApproval', id, 'UPDATE', userId, previous, result, req);
  const amount = toNumber(result.amount as unknown as DecimalLike);
  emitEvent({
    event: 'refund_approval.updated',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      status: result.status,
      approvedDate: result.approvedDate,
      processedDate: result.processedDate,
    },
  });
  emitEvent({
    event: 'refund_approval.status_changed',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: { previousStatus: previous.status, newStatus: result.status, amount },
  });
  emitEvent({
    event: 'refund_approval.rejected',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      rejectedBy: userId,
      reason: reason ?? null,
      proposedBy: previous.createdBy ?? null,
    },
  });
  return result;
}

export async function process(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  assertTransition(previous.status, 'PROCESSED');
  const result = await repo.update(id, {
    status: 'PROCESSED',
    processedDate: new Date(),
    updatedBy: userId,
  });
  await logAudit('RefundApproval', id, 'UPDATE', userId, previous, result, req);
  const amount = toNumber(result.amount as unknown as DecimalLike);
  emitEvent({
    event: 'refund_approval.updated',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      status: result.status,
      approvedDate: result.approvedDate,
      processedDate: result.processedDate,
    },
  });
  emitEvent({
    event: 'refund_approval.status_changed',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: { previousStatus: previous.status, newStatus: result.status, amount },
  });
  emitEvent({
    event: 'refund_approval.processed',
    entityType: 'RefundApproval',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      amount,
      processedBy: userId,
      processedDate: result.processedDate,
    },
  });
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
