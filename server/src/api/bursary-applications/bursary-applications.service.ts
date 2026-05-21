import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/bursaryApplication.repository';
import * as fundRepo from '../../repositories/bursaryFund.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';
import { runInTransaction } from '../../utils/prisma-tx';
import {
  evaluateBursaryEligibility,
  type BursaryDecisionOutcome,
  type BursaryEligibilityRules,
} from '../../utils/bursary-decision';

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
    // The standard update path is the canonical "manual override" — an
    // operator chose a status directly rather than letting the rule
    // engine drive it. Tag the status_changed event with
    // decisionMode: 'MANUAL' so downstream audit / n8n consumers can
    // tell a manual override apart from an `auto_decided` flip without
    // having to cross-reference timestamps.
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
        decisionMode: 'MANUAL',
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

// ── Phase 1C — bursary auto-decisioning ─────────────────────────────────────
//
// The operator-facing endpoint POST /v1/bursary-applications/:id/auto-decide
// runs the pure `evaluateBursaryEligibility` rule engine against the
// fund's stored eligibility JSON and (in persist mode, the default)
// applies the resulting decision atomically:
//
//   APPROVE — flips status to APPROVED, sets `awardAmount`, reserves the
//             award from the fund's `remaining` budget. All four mutations
//             happen inside a single Prisma `$transaction` so the fund
//             ledger never drifts out of sync with the application status.
//   REJECT  — flips status to REJECTED, clears `awardAmount`. No budget
//             change (nothing was reserved in the first place).
//   REVIEW  — flips status to UNDER_REVIEW (when previously SUBMITTED).
//             No award, no budget change. Manual operator decision required.
//
// Terminal-state guard: APPROVED, REJECTED, and PAID rows are not
// re-evaluated unless `force: true` is supplied. A re-evaluation that
// flips an already-APPROVED row to REJECT releases the previously
// reserved budget atomically.

export interface AutoDecideOptions {
  /** Persist the decision. Defaults to true (preview-mode opt-out). */
  persist?: boolean;
  /** Override per-call rules (otherwise the fund's stored eligibility JSON is used). */
  rules?: BursaryEligibilityRules;
  /** Re-evaluate a terminal-status row (APPROVED / REJECTED / PAID). */
  force?: boolean;
}

export interface AutoDecideResult extends BursaryDecisionOutcome {
  applicationId: string;
  bursaryFundId: string;
  previousStatus: string;
  newStatus: string;
  persisted: boolean;
  /** True when the decision changed the persisted award amount. */
  budgetReserved: number;
  /** True when the decision released a previously reserved award amount. */
  budgetReleased: number;
}

const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAID']);

function statusForDecision(decision: 'APPROVE' | 'REJECT' | 'REVIEW'): string {
  switch (decision) {
    case 'APPROVE':
      return 'APPROVED';
    case 'REJECT':
      return 'REJECTED';
    case 'REVIEW':
      return 'UNDER_REVIEW';
  }
}

export async function autoDecideForApplication(
  id: string,
  options: AutoDecideOptions,
  userId: string,
  req: Request,
): Promise<AutoDecideResult> {
  const application = await getById(id);
  const fund = await fundRepo.getById(application.bursaryFundId);
  if (!fund) {
    throw new NotFoundError('BursaryFund', application.bursaryFundId);
  }

  if (TERMINAL_STATUSES.has(application.status) && options.force !== true) {
    throw new ValidationError(
      `Bursary application ${id} is in terminal status ${application.status}; ` +
        `re-evaluate with force: true to override.`,
    );
  }

  const eligibility =
    options.rules ??
    ((fund as unknown as { eligibility?: BursaryEligibilityRules | null })
      .eligibility ?? null);

  const outcome = evaluateBursaryEligibility(
    {
      id: application.id,
      status: application.status,
      householdIncome:
        application.householdIncome == null
          ? null
          : toNumber(application.householdIncome as unknown as DecimalLike),
      circumstancesDesc: application.circumstancesDesc,
      // BursaryApplication does not carry feeStatus directly; the rule
      // engine reads it from the application snapshot only when the
      // caller has it. The wider student-finance enrolment context is
      // joined later by Phase 1F dashboards.
      feeStatus: null,
    },
    {
      id: fund.id,
      fundType: fund.fundType,
      remaining: toNumber(fund.remaining as unknown as DecimalLike),
      eligibility,
    },
  );

  const previousStatus = application.status;
  const previousAward =
    application.awardAmount == null
      ? 0
      : toNumber(application.awardAmount as unknown as DecimalLike);
  const newStatus = statusForDecision(outcome.decision);

  let persisted = false;
  let budgetReserved = 0;
  let budgetReleased = 0;

  if (options.persist !== false) {
    await runInTransaction(async (tx) => {
      // First, release any previously reserved award when re-deciding
      // an APPROVED row to anything other than APPROVE.
      if (
        previousStatus === 'APPROVED' &&
        outcome.decision !== 'APPROVE' &&
        previousAward > 0
      ) {
        await fundRepo.releaseBudgetInTx(fund.id, previousAward, tx);
        budgetReleased = previousAward;
      }

      if (outcome.decision === 'APPROVE') {
        const reserveAmount = outcome.suggestedAward - previousAward;
        if (reserveAmount > 0) {
          await fundRepo.reserveBudgetInTx(fund.id, reserveAmount, tx);
          budgetReserved = reserveAmount;
        } else if (reserveAmount < 0) {
          await fundRepo.releaseBudgetInTx(fund.id, Math.abs(reserveAmount), tx);
          budgetReleased = Math.abs(reserveAmount);
        }
        await repo.updateDecisionInTx(
          id,
          { status: newStatus, awardAmount: outcome.suggestedAward, updatedBy: userId },
          tx,
        );
      } else if (outcome.decision === 'REJECT') {
        await repo.updateDecisionInTx(
          id,
          { status: newStatus, awardAmount: null, updatedBy: userId },
          tx,
        );
      } else {
        // REVIEW — only flip status if it actually changes; do not
        // mutate awardAmount.
        if (previousStatus !== newStatus) {
          await repo.updateDecisionInTx(
            id,
            { status: newStatus, updatedBy: userId },
            tx,
          );
        }
      }
    });
    persisted = true;
  }

  await logAudit(
    'BursaryApplication',
    id,
    'UPDATE',
    userId,
    { status: previousStatus, awardAmount: previousAward },
    {
      status: newStatus,
      awardAmount: outcome.decision === 'APPROVE' ? outcome.suggestedAward : null,
      decisionMode: 'AUTO',
      decision: outcome.decision,
      reasons: outcome.reasons,
      persisted,
      budgetReserved,
      budgetReleased,
      force: options.force === true,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'bursary_application.auto_decided',
    entityType: 'BursaryApplication',
    entityId: id,
    actorId: userId,
    data: {
      bursaryFundId: fund.id,
      studentId: application.studentId,
      previousStatus,
      newStatus,
      decision: outcome.decision,
      decisionMode: 'AUTO',
      suggestedAward: outcome.suggestedAward,
      reasons: outcome.reasons,
      effectiveRules: outcome.effectiveRules,
      persisted,
      budgetReserved,
      budgetReleased,
      force: options.force === true,
    },
  });

  if (persisted && previousStatus !== newStatus) {
    emitEvent({
      event: 'bursary_application.status_changed',
      entityType: 'BursaryApplication',
      entityId: id,
      actorId: userId,
      data: {
        previousStatus,
        newStatus,
        awardAmount: outcome.decision === 'APPROVE' ? outcome.suggestedAward : null,
        decisionMode: 'AUTO',
      },
    });
  }

  return {
    ...outcome,
    applicationId: id,
    bursaryFundId: fund.id,
    previousStatus,
    newStatus,
    persisted,
    budgetReserved,
    budgetReleased,
  };
}
