import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/feeAssessment.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as bursaryRepo from '../../repositories/bursaryApplication.repository';
import * as sponsorRepo from '../../repositories/sponsorAgreement.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  calculateFee,
  type FeeCalculationContribution,
  type FeeCalculationOutcome,
  type FeeCalculationRules,
  type FeeStatus,
  type ModeOfStudy,
  type ProgrammeLevel,
} from '../../utils/fee-calculation';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── List query ───────────────────────────────────────────────────────────────

export interface FeeAssessmentListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  enrolmentId?: string;
  feeStatus?: string;
}

export async function list(query: FeeAssessmentListQuery) {
  const { cursor, limit, sort, order, enrolmentId, feeStatus } = query;
  return repo.list({ enrolmentId, feeStatus }, { cursor, limit, sort, order });
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('FeeAssessment', id);
  return result;
}

export async function create(
  data: Prisma.FeeAssessmentUncheckedCreateInput,
  userId: string,
  req: Request,
) {
  const result = await repo.create(data);
  await logAudit('FeeAssessment', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'fee_assessment.created',
    entityType: 'FeeAssessment',
    entityId: result.id,
    actorId: userId,
    data: {
      enrolmentId: result.enrolmentId,
      feeStatus: result.feeStatus,
      totalFee: toNumber(result.totalFee as unknown as DecimalLike),
      finalFee: toNumber(result.finalFee as unknown as DecimalLike),
    },
  });
  return result;
}

export async function update(
  id: string,
  data: Prisma.FeeAssessmentUpdateInput,
  userId: string,
  req: Request,
) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('FeeAssessment', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'fee_assessment.updated',
    entityType: 'FeeAssessment',
    entityId: id,
    actorId: userId,
    data: {
      enrolmentId: result.enrolmentId,
      feeStatus: result.feeStatus,
      totalFee: toNumber(result.totalFee as unknown as DecimalLike),
      finalFee: toNumber(result.finalFee as unknown as DecimalLike),
    },
  });
  return result;
}

// ── Phase 18A — fee calculation orchestrator ────────────────────────────────
//
// Drives the canonical UK HE fee rule via the pure `calculateFee` utility.
// Loads the enrolment + programme metadata, gathers awarded bursaries and
// active sponsor agreements for the (student, academicYear) pair, calls
// the pure utility, and (optionally) persists a FeeAssessment row through
// the existing service create/update path so audit + canonical events
// fire on their normal paths.

/** Inputs accepted by the assessor (all forwarded to the pure utility). */
export interface AssessForEnrolmentOptions {
  /** Override the credits assumed for the assessment (defaults to programme.creditTotal). */
  creditsTaken?: number;
  /** Rule overrides forwarded to `calculateFee`. */
  rules?: FeeCalculationRules;
  /** Persist a FeeAssessment row. Defaults to false (preview only). */
  persist?: boolean;
  /** Operator override: persist even when totalFee is 0 (e.g. pre-bursary preview-as-zero). */
  force?: boolean;
}

/** Persistable / preview-able outcome returned by the service. */
export interface AssessForEnrolmentResult extends FeeCalculationOutcome {
  enrolmentId: string;
  studentId: string;
  programmeId: string;
  academicYear: string;
  yearOfStudy: number;
  programmeLevel: ProgrammeLevel;
  feeStatus: FeeStatus;
  modeOfStudy: ModeOfStudy;
  /** True when a FeeAssessment row was upserted on this call. */
  persisted: boolean;
  /** Set when persisted; null on preview. */
  feeAssessmentId: string | null;
  /** Bursary references that contributed to the discount (audit trail). */
  bursaryReferences: string[];
  /** Sponsor agreement references that contributed to the discount (audit trail). */
  sponsorReferences: string[];
}

/**
 * Compute and (optionally) persist a fee assessment for a single
 * enrolment. Pure arithmetic is delegated to `utils/fee-calculation`;
 * this function is the I/O orchestrator.
 *
 * @throws NotFoundError when the enrolment does not exist.
 * @throws ValidationError when the programme is missing required metadata
 *         (level, modeOfStudy, or creditTotal) and the caller has not
 *         supplied a `creditsTaken` override.
 */
export async function assessForEnrolment(
  enrolmentId: string,
  options: AssessForEnrolmentOptions,
  userId: string,
  req: Request,
): Promise<AssessForEnrolmentResult> {
  const enrolment = await enrolmentRepo.getById(enrolmentId);
  if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

  const programme = (enrolment as unknown as {
    programme?: { id?: string; level?: string; creditTotal?: number };
  }).programme;
  if (!programme?.level) {
    throw new ValidationError(
      `Enrolment ${enrolmentId} has no programme level — cannot calculate fee.`,
    );
  }

  const programmeLevel = programme.level as ProgrammeLevel;
  const programmeId = programme.id ?? '';
  const studentId = (enrolment as unknown as { studentId?: string }).studentId ?? '';
  const academicYear = (enrolment as unknown as { academicYear?: string }).academicYear ?? '';
  const yearOfStudy = (enrolment as unknown as { yearOfStudy?: number }).yearOfStudy ?? 1;
  const feeStatus = (enrolment as unknown as { feeStatus?: string }).feeStatus as FeeStatus;
  const modeOfStudy = (enrolment as unknown as { modeOfStudy?: string }).modeOfStudy as ModeOfStudy;

  const creditsTaken = (() => {
    if (typeof options.creditsTaken === 'number' && options.creditsTaken > 0) {
      return options.creditsTaken;
    }
    if (typeof programme.creditTotal === 'number' && programme.creditTotal > 0) {
      return programme.creditTotal;
    }
    throw new ValidationError(
      `Cannot determine creditsTaken for enrolment ${enrolmentId}: programme has no creditTotal and no override supplied.`,
    );
  })();

  const [bursaryRows, sponsorRows] = await Promise.all([
    studentId && academicYear
      ? bursaryRepo.findAwardedByStudent(studentId, academicYear)
      : Promise.resolve([]),
    studentId && academicYear
      ? sponsorRepo.findActiveByStudentYear(studentId, academicYear)
      : Promise.resolve([]),
  ]);

  const bursaries: FeeCalculationContribution[] = bursaryRows.map((b) => ({
    amount: toNumber((b as unknown as { awardAmount?: DecimalLike }).awardAmount),
    reference: b.id,
  }));
  const sponsorContributions: FeeCalculationContribution[] = sponsorRows.map((s) => ({
    amount: toNumber((s as unknown as { amountAgreed?: DecimalLike }).amountAgreed),
    reference: s.id,
  }));

  const outcome = calculateFee({
    programmeLevel,
    creditsTaken,
    feeStatus,
    modeOfStudy,
    yearOfStudy,
    bursaries,
    sponsorContributions,
    rules: options.rules,
  });

  // Persist path — upsert a FeeAssessment against the most recent record
  // for the enrolment. Refuse to persist when the input produced a
  // zero totalFee unless `force: true` (operators occasionally want a
  // £0 row to record a fully-waived assessment).
  let persisted = false;
  let feeAssessmentId: string | null = null;

  if (options.persist === true) {
    if (outcome.totalFee === 0 && options.force !== true) {
      throw new ValidationError(
        `Cannot persist fee assessment for enrolment ${enrolmentId}: ` +
          `calculated totalFee is 0. Re-run with force: true to persist anyway.`,
      );
    }
    const existing = await repo.findLatestByEnrolment(enrolmentId);
    if (existing && options.force !== true) {
      const updated = await update(
        existing.id,
        {
          feeStatus: feeStatus as Prisma.FeeAssessmentUpdateInput['feeStatus'],
          assessedDate: new Date(),
          totalFee: outcome.totalFee,
          discountAmount: outcome.discountAmount,
          finalFee: outcome.finalFee,
          assessedBy: userId,
        },
        userId,
        req,
      );
      feeAssessmentId = updated.id;
    } else {
      const created = await create(
        {
          enrolmentId,
          feeStatus: feeStatus as Prisma.FeeAssessmentUncheckedCreateInput['feeStatus'],
          assessedDate: new Date(),
          totalFee: outcome.totalFee,
          discountAmount: outcome.discountAmount,
          finalFee: outcome.finalFee,
          assessedBy: userId,
        },
        userId,
        req,
      );
      feeAssessmentId = created.id;
    }
    persisted = true;
  }

  const bursaryReferences = bursaries
    .map((b) => b.reference)
    .filter((r): r is string => typeof r === 'string' && r.length > 0);
  const sponsorReferences = sponsorContributions
    .map((s) => s.reference)
    .filter((r): r is string => typeof r === 'string' && r.length > 0);

  await logAudit(
    'Enrolment',
    enrolmentId,
    'UPDATE',
    userId,
    null,
    {
      academicYear,
      yearOfStudy,
      feeStatus,
      modeOfStudy,
      totalFee: outcome.totalFee,
      discountAmount: outcome.discountAmount,
      finalFee: outcome.finalFee,
      persisted,
      feeAssessmentId,
      bursaryReferences,
      sponsorReferences,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'fee_assessment.calculated',
    entityType: 'Enrolment',
    entityId: enrolmentId,
    actorId: userId,
    data: {
      enrolmentId,
      studentId,
      programmeId,
      academicYear,
      yearOfStudy,
      programmeLevel,
      feeStatus,
      modeOfStudy,
      creditsTaken: outcome.breakdown.creditsTaken,
      totalFee: outcome.totalFee,
      discountAmount: outcome.discountAmount,
      finalFee: outcome.finalFee,
      effectiveRules: outcome.effectiveRules,
      bursaryReferences,
      sponsorReferences,
      notes: outcome.notes,
      persisted,
      feeAssessmentId,
      force: options.force === true,
    },
  });

  return {
    ...outcome,
    enrolmentId,
    studentId,
    programmeId,
    academicYear,
    yearOfStudy,
    programmeLevel,
    feeStatus,
    modeOfStudy,
    persisted,
    feeAssessmentId,
    bursaryReferences,
    sponsorReferences,
  };
}
