import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/paymentInstalment.repository';
import * as planRepo from '../../repositories/paymentPlan.repository';
import * as paymentRepo from '../../repositories/payment.repository';
import * as chargeLineRepo from '../../repositories/chargeLine.repository';
import * as financeRepo from '../../repositories/finance.repository';
import * as paymentService from '../payments/payments.service';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';

import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── List query ───────────────────────────────────────────────────────────────

export interface PaymentInstalmentListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  paymentPlanId?: string;
  status?: string;
}

export async function list(query: PaymentInstalmentListQuery) {
  const { cursor, limit, sort, order, paymentPlanId, status } = query;
  return repo.list({ paymentPlanId, status }, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('PaymentInstalment', id);
  return result;
}

export async function update(
  id: string,
  data: Prisma.PaymentInstalmentUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('PaymentInstalment', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'payment_instalment.updated',
    entityType: 'PaymentInstalment',
    entityId: id,
    actorId: userId,
    data: {
      paymentPlanId: result.paymentPlanId,
      instalmentNum: result.instalmentNum,
      status: result.status,
    },
  });
  if (result.status !== previous.status) {
    emitEvent({
      event: 'payment_instalment.status_changed',
      entityType: 'PaymentInstalment',
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
  await logAudit('PaymentInstalment', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'payment_instalment.deleted',
    entityType: 'PaymentInstalment',
    entityId: id,
    actorId: userId,
    data: {
      paymentPlanId: previous.paymentPlanId,
      instalmentNum: previous.instalmentNum,
    },
  });
}

// ── Phase 18D — Bridge: record a Payment against an instalment ───────────────

export interface RecordPaymentOptions {
  /** The Payment to apply against this instalment. */
  paymentId: string;
  /**
   * Allocation strategy forwarded to the 18C `paymentService.allocateForPayment`
   * call. Defaults to FIFO.
   */
  strategy?: 'FIFO' | 'PROPORTIONAL';
  /**
   * Operator override:
   *   - allocates a non-COMPLETED Payment (forwarded to 18C as `force`)
   *   - accepts a Payment whose amount is less than the instalment amount
   *   - allows rebinding when the instalment is already COMPLETED
   *   - allows binding a Payment whose StudentAccount differs from the plan's
   */
  force?: boolean;
}

export interface RecordPaymentResult {
  paymentInstalmentId: string;
  paymentId: string;
  paymentPlanId: string;
  /** Allocation outcome forwarded from 18C `allocateForPayment`. */
  allocation: Awaited<ReturnType<typeof paymentService.allocateForPayment>>;
  /** True when the instalment was flipped to COMPLETED by this call. */
  instalmentMarkedPaid: boolean;
  /** True when the parent PaymentPlan transitioned to COMPLETED because all instalments are now COMPLETED. */
  planMarkedCompleted: boolean;
}

/**
 * Record a Payment against a specific PaymentInstalment.
 *
 * Bridges 18D (PaymentPlan / PaymentInstalment) into the 18C
 * allocation pipeline. The flow:
 *
 *   1. Resolve the instalment + parent plan + payment (NotFound on
 *      any missing).
 *   2. Validate the instalment is PENDING (or `force: true`); reject
 *      re-recording against an already-COMPLETED instalment.
 *   3. Validate the payment.studentAccountId matches the plan's
 *      studentAccountId — paying off another student's instalment is
 *      a clear data-entry error (override with `force: true` for
 *      sponsor / consolidation scenarios).
 *   4. Validate payment.amount >= instalment.amount (or `force:
 *      true` for partial-coverage operator overrides).
 *   5. Unless `force: true`, require at least one open ChargeLine on
 *      the plan's StudentAccount so allocation cannot commit a
 *      ledger-only credit while this instalment stays PENDING.
 *   6. Call `paymentService.allocateForPayment` to flip the
 *      underlying ChargeLines and invoice/account ledger entries
 *      atomically. The 18C transaction is the source of truth for
 *      ledger consistency; this bridge does not nest its own
 *      transaction so the 18C invariants stay intact.
 *   7. Flip this PaymentInstalment to status=COMPLETED + paidDate=
 *      payment.transactionDate via the standard `update()` path so
 *      audit + `payment_instalment.updated` + `payment_instalment.
 *      status_changed` events fire on their normal paths.
 *   8. Re-read the parent plan's instalments. If every instalment is
 *      COMPLETED, promote the plan to status=COMPLETED via the
 *      standard plan service update path so the plan's audit +
 *      `payment_plan.updated` + `payment_plan.status_changed` events
 *      fire as well.
 *
 * Always emits `payment_instalment.paid` so n8n integrations can
 * react to a successful instalment-record without inferring it from
 * the UPDATE event.
 *
 * @throws NotFoundError when the instalment or payment does not exist.
 * @throws ValidationError on the validation conditions above when
 *         `force: true` is not supplied.
 */
export async function recordPayment(
  instalmentId: string,
  options: RecordPaymentOptions,
  userId: string,
  req: Request,
): Promise<RecordPaymentResult> {
  const instalment = await repo.getById(instalmentId);
  if (!instalment) throw new NotFoundError('PaymentInstalment', instalmentId);

  if (instalment.status === 'COMPLETED' && options.force !== true) {
    throw new ValidationError(
      `Cannot record payment against instalment ${instalmentId}: status is already COMPLETED. Re-run with force: true to rebind.`,
    );
  }

  const plan = await planRepo.getById(instalment.paymentPlanId);
  if (!plan) throw new NotFoundError('PaymentPlan', instalment.paymentPlanId);

  const payment = await paymentRepo.getById(options.paymentId);
  if (!payment) throw new NotFoundError('Payment', options.paymentId);

  if (
    payment.studentAccountId !== plan.studentAccountId &&
    options.force !== true
  ) {
    throw new ValidationError(
      `Payment ${options.paymentId} belongs to StudentAccount ${payment.studentAccountId} but the PaymentPlan is on ${plan.studentAccountId}. Re-run with force: true to bind anyway (e.g. sponsor consolidation).`,
    );
  }

  const paymentAmount = toNumber(payment.amount as unknown as DecimalLike);
  const instalmentAmount = toNumber(instalment.amount as unknown as DecimalLike);
  if (paymentAmount + 0.005 < instalmentAmount && options.force !== true) {
    throw new ValidationError(
      `Payment amount ${paymentAmount.toFixed(2)} is less than instalment amount ${instalmentAmount.toFixed(2)}. Re-run with force: true to record a partial coverage.`,
    );
  }

  // Guard (pre-allocation): before committing the allocation, verify the
  // account has open charges to absorb the payment. Without a chargeLineId
  // FK on the instalment we cannot confirm a specific charge matches this
  // instalment, but we can refuse to mark it COMPLETED when the entire
  // payment would become an unapplied credit balance. Running this check
  // before allocateForPayment ensures no DB side-effects (allocatedAt stamp
  // + ledger update) are committed when the guard fires.
  if (options.force !== true) {
    const openCharges = await chargeLineRepo.findOpenForAccount(plan.studentAccountId);
    if (openCharges.length === 0) {
      throw new ValidationError(
        `Payment ${options.paymentId} cannot be recorded against instalment ${instalmentId}: ` +
          `account ${plan.studentAccountId} has no open charges to allocate against. ` +
          'Re-run with force: true to mark the instalment COMPLETED without a matched charge allocation.',
      );
    }
  }

  // Drive the 18C allocation pipeline. The allocator opens its own
  // transaction; this bridge intentionally does not nest, so the 18C
  // invariants on ChargeLine / Invoice / StudentAccount stay
  // authoritative.
  const allocation = await paymentService.allocateForPayment(
    options.paymentId,
    {
      ...(options.strategy ? { strategy: options.strategy } : {}),
      persist: true,
      ...(options.force === true ? { force: true } : {}),
    },
    userId,
    req,
  );

  // Flip the instalment to COMPLETED via the standard update path.
  const transactionDate = payment.transactionDate ?? new Date();
  const updatedInstalment = await update(
    instalmentId,
    {
      status: 'COMPLETED',
      paidDate: transactionDate,
    },
    userId,
    req,
  );

  emitEvent({
    event: 'payment_instalment.paid',
    entityType: 'PaymentInstalment',
    entityId: instalmentId,
    actorId: userId,
    data: {
      paymentPlanId: instalment.paymentPlanId,
      paymentId: options.paymentId,
      instalmentNum: instalment.instalmentNum,
      amount: instalmentAmount,
      paymentAmount,
      paidChargeLineIds: allocation.paidChargeLineIds,
      ...(options.force === true ? { force: true } : {}),
    },
  });

  // Promote plan to COMPLETED if every instalment is COMPLETED.
  let planMarkedCompleted = false;
  const refreshedPlan = await planRepo.getById(instalment.paymentPlanId);
  if (refreshedPlan && refreshedPlan.status === 'ACTIVE') {
    const allCompleted = refreshedPlan.instalments.every(
      (inst) => inst.status === 'COMPLETED',
    );
    if (allCompleted) {
      const previous = refreshedPlan;
      const nextPlan = await planRepo.update(refreshedPlan.id, { status: 'COMPLETED' });
      await logAudit('PaymentPlan', refreshedPlan.id, 'UPDATE', userId, previous, nextPlan, req);
      emitEvent({
        event: 'payment_plan.updated',
        entityType: 'PaymentPlan',
        entityId: refreshedPlan.id,
        actorId: userId,
        data: {
          studentAccountId: nextPlan.studentAccountId,
          status: nextPlan.status,
        },
      });
      emitEvent({
        event: 'payment_plan.status_changed',
        entityType: 'PaymentPlan',
        entityId: refreshedPlan.id,
        actorId: userId,
        data: {
          previousStatus: previous.status,
          newStatus: nextPlan.status,
        },
      });
      planMarkedCompleted = true;
    }
  }

  return {
    paymentInstalmentId: instalmentId,
    paymentId: options.paymentId,
    paymentPlanId: instalment.paymentPlanId,
    allocation,
    instalmentMarkedPaid: updatedInstalment.status === 'COMPLETED',
    planMarkedCompleted,
  };
}

// ── Process-overdue cron (Phase 1A) ──────────────────────────────────────────

/**
 * Auto-generate ChargeLines for PaymentInstalments whose `dueDate` has
 * passed and whose `status` is still `PENDING`. Run on a daily BullMQ
 * cron by `server/src/workers/payment-instalment-cron.worker.ts`.
 *
 * Each issued ChargeLine carries an embedded `[instalment:${id}]`
 * marker in its `description` so re-runs are idempotent —
 * `chargeLineRepo.findByInstalmentMarker` is checked before each create
 * and existing rows are reported as `skipped`. Without a dedicated
 * `PaymentInstalment.chargeLineId` FK (sequenced to a later phase per
 * the 18D out-of-scope note), the marker pattern is the canonical
 * idempotency tag.
 *
 * The cron does NOT mutate the PaymentInstalment itself — it stays
 * `PENDING` until the operator records a payment via the existing
 * `recordPayment` bridge, at which point the 18C allocator covers the
 * ChargeLine and flips the instalment to `COMPLETED`. The cron's
 * single job is "make the charge visible to the allocator".
 *
 * Audit subject is the StudentAccount (the account picks up the new
 * balance impact). A per-row `charge_line.created_for_instalment` event
 * is emitted via the outbox so downstream consumers (n8n notification
 * workflows, ledger anomaly detector, etc.) can react per instalment.
 * A summary `payment_instalment.cron_processed` event fires once at
 * the end with the run-level outcome.
 */
export interface ProcessOverdueOptions {
  asOf?: Date;
  trigger?: 'cron' | 'manual';
}

export interface ProcessOverdueRowOutcome {
  instalmentId: string;
  paymentPlanId: string;
  studentAccountId: string;
  status: 'charged' | 'skipped' | 'failed';
  chargeLineId?: string;
  reason?: string;
}

export interface ProcessOverdueOutcome {
  asOf: string;
  trigger: 'cron' | 'manual';
  total: number;
  charged: number;
  skipped: number;
  failed: number;
  results: ProcessOverdueRowOutcome[];
}

const CRON_USER_ID = 'system:payment-instalment-cron';

export async function processOverdueInstalments(
  options: ProcessOverdueOptions = {},
  userId: string = CRON_USER_ID,
  req?: Request,
): Promise<ProcessOverdueOutcome> {
  const asOf = options.asOf ?? new Date();
  const trigger = options.trigger ?? 'manual';

  const overdue = await repo.findOverdue(asOf);
  const results: ProcessOverdueRowOutcome[] = [];
  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (const instalment of overdue) {
    const plan = instalment.paymentPlan;
    if (!plan) {
      results.push({
        instalmentId: instalment.id,
        paymentPlanId: instalment.paymentPlanId,
        studentAccountId: 'unknown',
        status: 'failed',
        reason: 'parent PaymentPlan not loaded',
      });
      failed++;
      continue;
    }

    try {
      // Idempotency check: did a previous cron run already issue a charge?
      const existing = await chargeLineRepo.findByInstalmentMarker(
        plan.studentAccountId,
        instalment.id,
      );
      if (existing) {
        results.push({
          instalmentId: instalment.id,
          paymentPlanId: plan.id,
          studentAccountId: plan.studentAccountId,
          status: 'skipped',
          chargeLineId: existing.id,
          reason: `charge-line-already-issued (status=${existing.status})`,
        });
        skipped++;
        continue;
      }

      // Issue the charge. Description carries:
      //   - human-readable summary for operator UI / statement rendering
      //   - the [instalment:${id}] marker for the idempotency check above
      const dueDateIso = instalment.dueDate.toISOString().slice(0, 10);
      const description =
        `Instalment ${instalment.instalmentNum} of ${plan.numberOfInstalments} ` +
        `due ${dueDateIso} (plan ${plan.id}) [instalment:${instalment.id}]`;

      const chargeData: Prisma.ChargeLineUncheckedCreateInput = {
        studentAccountId: plan.studentAccountId,
        chargeType: 'OTHER',
        description,
        amount: instalment.amount,
        currency: 'GBP',
        status: 'PENDING',
        dueDate: instalment.dueDate,
        createdBy: userId,
      };
      const charge = await financeRepo.createCharge(chargeData);

      results.push({
        instalmentId: instalment.id,
        paymentPlanId: plan.id,
        studentAccountId: plan.studentAccountId,
        status: 'charged',
        chargeLineId: charge.id,
      });
      charged++;

      // Per-row event so n8n workflows can wire notifications etc.
      emitEvent({
        event: 'payment_instalment.due',
        entityType: 'PaymentInstalment',
        entityId: instalment.id,
        actorId: userId,
        data: {
          paymentPlanId: plan.id,
          studentAccountId: plan.studentAccountId,
          chargeLineId: charge.id,
          amount: Number(instalment.amount),
          dueDate: dueDateIso,
          instalmentNum: instalment.instalmentNum,
        },
      });
    } catch (err) {
      results.push({
        instalmentId: instalment.id,
        paymentPlanId: plan.id,
        studentAccountId: plan.studentAccountId,
        status: 'failed',
        reason: (err as Error).message,
      });
      failed++;
    }
  }

  // Run-level audit + summary event. Subject is the synthetic
  // "PaymentInstalmentCron" entity so the run is greppable in the audit
  // log without colliding with per-row PaymentInstalment audits.
  const outcome: ProcessOverdueOutcome = {
    asOf: asOf.toISOString(),
    trigger,
    total: overdue.length,
    charged,
    skipped,
    failed,
    results,
  };

  // Audit action `CREATE` reflects "a new cron run was created" — the
  // AuditAction enum has no dedicated EXECUTE / RUN value. The subject
  // type `PaymentInstalmentCron` distinguishes this from per-row
  // PaymentInstalment audits so grep'ing the audit log can separate
  // the two surfaces cleanly.
  await logAudit(
    'PaymentInstalmentCron',
    asOf.toISOString(),
    'CREATE',
    userId,
    null,
    outcome,
    req,
  );
  emitEvent({
    event: 'payment_instalment.cron_processed',
    entityType: 'PaymentInstalmentCron',
    entityId: asOf.toISOString(),
    actorId: userId,
    data: {
      trigger,
      total: outcome.total,
      charged: outcome.charged,
      skipped: outcome.skipped,
      failed: outcome.failed,
    },
  });

  return outcome;
}
