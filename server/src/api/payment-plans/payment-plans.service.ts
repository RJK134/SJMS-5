import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/paymentPlan.repository';
import * as financeRepo from '../../repositories/finance.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  generatePlanSchedule,
  type InstalmentFrequency,
  type PaymentPlanScheduleOutcome,
} from '../../utils/payment-plan-schedule';

import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── List query ───────────────────────────────────────────────────────────────

export interface PaymentPlanListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentAccountId?: string;
  status?: string;
  planType?: string;
}

export async function list(query: PaymentPlanListQuery) {
  const { cursor, limit, sort, order, studentAccountId, status, planType } = query;
  return repo.list(
    { studentAccountId, status, planType },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('PaymentPlan', id);
  return result;
}

export async function create(
  data: Prisma.PaymentPlanUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  void data;
  void userId;
  void req;

  throw new ValidationError(
    'Direct payment plan creation is not supported because it only persists the plan header without its instalment schedule. ' +
      'Use POST /v1/payment-plans/generate which atomically creates the plan and its full instalment schedule.',
  );
}

export async function update(
  id: string,
  data: Prisma.PaymentPlanUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('PaymentPlan', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'payment_plan.updated',
    entityType: 'PaymentPlan',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: result.studentAccountId,
      planType: result.planType,
      totalAmount: toNumber(result.totalAmount as unknown as DecimalLike),
      status: result.status,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'payment_plan.status_changed',
      entityType: 'PaymentPlan',
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
  await logAudit('PaymentPlan', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'payment_plan.deleted',
    entityType: 'PaymentPlan',
    entityId: id,
    actorId: userId,
    data: {
      studentAccountId: previous.studentAccountId,
      planType: previous.planType,
    },
  });
}

// ── Phase 18D — Generate plan from schedule input ────────────────────────────

export interface GeneratePlanOptions {
  studentAccountId: string;
  planType?: string;
  totalAmount: number;
  numberOfInstalments: number;
  startDate: Date;
  frequency?: InstalmentFrequency;
  customDates?: Date[];
  initialStatus?: 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'CANCELLED';
  /** Persist the plan + schedule (default true). Preview mode returns the schedule without writing. */
  persist?: boolean;
}

export interface GeneratePlanResult {
  schedule: PaymentPlanScheduleOutcome;
  persisted: boolean;
  paymentPlanId: string | null;
}

/**
 * Generate a PaymentPlan + PaymentInstalment schedule for a
 * StudentAccount.
 *
 * Loads the StudentAccount via `finance.repository.findByStudentAndYear`
 * indirectly through `getAccountById` (we use the lighter projection
 * `getAccountBalance` only for existence — the StudentAccount may
 * exist in any state). Calls the pure `generatePlanSchedule` utility
 * to derive the per-instalment dates and amounts, then (in persist
 * mode, the default) atomically writes the plan + instalments via
 * `paymentPlan.repository.createWithInstalments`.
 *
 * Refuses to persist when the schedule is empty (no instalments
 * generated) — operators get a clear error directing them to the
 * underlying note from the pure utility.
 *
 * Audit subject is the StudentAccount entity (a payment plan is
 * conceptually attached to an account). The per-row CREATE audit on
 * the resulting PaymentPlan fires through the normal `create()` path
 * via the standard CRUD audit. We additionally emit a structured
 * `payment_plan.schedule_generated` event regardless of preview /
 * persist mode so n8n integrations can react to a schedule attempt.
 *
 * @throws NotFoundError when the StudentAccount does not exist.
 * @throws ValidationError when the schedule is empty and persist=true.
 */
export async function generatePlan(
  options: GeneratePlanOptions,
  userId: string,
  req: Request,
): Promise<GeneratePlanResult> {
  const account = await financeRepo.getAccountById(options.studentAccountId);
  if (!account) throw new NotFoundError('StudentAccount', options.studentAccountId);

  const schedule = generatePlanSchedule({
    totalAmount: options.totalAmount,
    numberOfInstalments: options.numberOfInstalments,
    startDate: options.startDate,
    ...(options.frequency ? { frequency: options.frequency } : {}),
    ...(options.customDates ? { customDates: options.customDates } : {}),
  });

  let persisted = false;
  let paymentPlanId: string | null = null;

  if (options.persist !== false) {
    if (schedule.instalments.length === 0) {
      throw new ValidationError(
        `Cannot persist payment plan with empty schedule. ${schedule.notes.join(' ') || 'No instalments generated.'}`,
      );
    }

    const planType = options.planType ?? 'INSTALMENT_PLAN';
    const initialStatus = options.initialStatus ?? 'ACTIVE';
    const created = await repo.createWithInstalments(
      {
        studentAccountId: options.studentAccountId,
        planType,
        totalAmount: schedule.totalAmount,
        numberOfInstalments: schedule.numberOfInstalments,
        instalmentAmount: schedule.baseAmount,
        startDate: schedule.effectiveStart,
        status: initialStatus,
        createdBy: userId,
      },
      schedule.instalments.map((inst) => ({
        instalmentNum: inst.instalmentNum,
        amount: inst.amount,
        dueDate: inst.dueDate,
        status: 'PENDING',
        createdBy: userId,
      })),
    );

    persisted = true;
    paymentPlanId = created.id;

    await logAudit('PaymentPlan', created.id, 'CREATE', userId, null, created, req);
    emitEvent({
      event: 'payment_plan.created',
      entityType: 'PaymentPlan',
      entityId: created.id,
      actorId: userId,
      data: {
        studentAccountId: created.studentAccountId,
        planType: created.planType,
        totalAmount: toNumber(created.totalAmount as unknown as DecimalLike),
        numberOfInstalments: created.numberOfInstalments,
        status: created.status,
      },
    });
  }

  emitEvent({
    event: 'payment_plan.schedule_generated',
    entityType: 'StudentAccount',
    entityId: options.studentAccountId,
    actorId: userId,
    data: {
      paymentPlanId,
      frequency: schedule.frequency,
      totalAmount: schedule.totalAmount,
      numberOfInstalments: schedule.numberOfInstalments,
      baseAmount: schedule.baseAmount,
      driftAdjustment: schedule.driftAdjustment,
      persisted,
      notes: schedule.notes,
    },
  });

  return { schedule, persisted, paymentPlanId };
}
