import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/progressionRecord.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { PASSING_GRADES } from '../../utils/pass-marks';
import {
  decideProgression,
  type ProgressionInput,
  type ProgressionOutcome,
  type ProgressionRules,
  type ProgrammeLevel,
} from '../../utils/progression-decision';

export interface ProgressionListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  enrolmentId?: string;
  decision?: string;
}

export async function list(query: ProgressionListQuery) {
  const { cursor, limit, sort, order, enrolmentId, decision } = query;
  return repo.list(
    { enrolmentId, decision },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('ProgressionRecord', id);
  return result;
}

export async function create(data: Prisma.ProgressionRecordUncheckedCreateInput, userId: string, req: Request) {
  const result = await repo.create(data);
  await logAudit('ProgressionRecord', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'progressions.created',
    entityType: 'ProgressionRecord',
    entityId: result.id,
    actorId: userId,
    data: {
      enrolmentId: result.enrolmentId,
      decision: result.progressionDecision,
      academicYear: (result as { academicYear?: string }).academicYear ?? null,
    },
  });
  return result;
}

export async function update(id: string, data: Prisma.ProgressionRecordUpdateInput, userId: string, req: Request) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('ProgressionRecord', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'progressions.updated',
    entityType: 'ProgressionRecord',
    entityId: id,
    actorId: userId,
    data: {
      enrolmentId: result.enrolmentId,
      decision: result.progressionDecision,
    },
  });
  if (result.progressionDecision !== previous.progressionDecision) {
    emitEvent({
      event: 'progressions.decision_changed',
      entityType: 'ProgressionRecord',
      entityId: id,
      actorId: userId,
      data: {
        enrolmentId: result.enrolmentId,
        previousDecision: previous.progressionDecision,
        newDecision: result.progressionDecision,
      },
    });
  }
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('ProgressionRecord', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'progressions.deleted',
    entityType: 'ProgressionRecord',
    entityId: id,
    actorId: userId,
    data: { enrolmentId: previous.enrolmentId },
  });
}

// ── Progression decisioning (Phase 17D) ──────────────────────────────────────
//
// Drives the canonical progression rules engine. Loads the year's
// ModuleResults, determines per-module pass status from the
// `ModuleResult.aggregateMark`/`grade`/`status` triple, calls the pure
// utility `decideProgression`, and (optionally) persists a
// ProgressionRecord. Preview vs persist parity matches the 17A / 17C
// pattern so cohort and per-row tooling can be developed against the
// same shape.
//
// Pass detection — the pure utility expects a boolean `isPass` per module.
// This service derives it from:
//   1. ModuleResult.status === 'CONFIRMED' AND aggregateMark != null
//      AND aggregateMark >= passMark — the canonical numerical pass.
//   2. status === 'CONFIRMED' AND grade is in the passing-grades set —
//      the fallback for assessments without a numeric mark.
//   3. Otherwise → not a pass.
//
// Pass marks default to UK HE convention (40 for L3-L6, 50 for L7-L8).
// PASSING_GRADES is taken from the existing `utils/pass-marks` so the
// decisioner shares a single grade-string source with module-registration
// prerequisite checking.

/** Default per-level pass marks in percentage points. */
const DEFAULT_PASS_MARKS: Record<ProgrammeLevel, number> = {
  LEVEL_3: 40,
  LEVEL_4: 40,
  LEVEL_5: 40,
  LEVEL_6: 40,
  LEVEL_7: 50,
  LEVEL_8: 50,
};

/** Inputs accepted by the decisioner (all forwarded to the pure utility). */
export interface DecideProgressionOptions {
  /** Override the per-level pass mark (e.g. when programme-level rules apply). */
  passMark?: number;
  /** Rule overrides forwarded to `decideProgression`. */
  rules?: ProgressionRules;
  /** Persist a ProgressionRecord row. Defaults to false (preview only). */
  persist?: boolean;
  /** Operator override for an empty year — no effect on the persist path. */
  force?: boolean;
}

/** Persistable / preview-able outcome returned by the service. */
export interface DecideProgressionResult extends ProgressionOutcome {
  enrolmentId: string;
  academicYear: string;
  yearOfStudy: number;
  programmeLevel: ProgrammeLevel;
  isFinalYear: boolean;
  /** True when a ProgressionRecord was upserted on this call. */
  persisted: boolean;
  /** Set when persisted; null on preview. */
  progressionRecordId: string | null;
}

/**
 * Decide progression for a single (enrolment, academicYear) pair. Pure
 * arithmetic is delegated to `utils/progression-decision`; this function
 * is the I/O orchestrator.
 *
 * @throws NotFoundError when the enrolment does not exist.
 */
export async function decideForEnrolmentYear(
  enrolmentId: string,
  academicYear: string,
  options: DecideProgressionOptions,
  userId: string,
  req: Request,
): Promise<DecideProgressionResult> {
  const enrolment = await enrolmentRepo.getById(enrolmentId);
  if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

  const programmeLevel = (enrolment as unknown as { programme?: { level?: string }; yearOfStudy?: number; programmeId?: string })
    .programme?.level as ProgrammeLevel | undefined;
  if (!programmeLevel) {
    throw new ValidationError(
      `Enrolment ${enrolmentId} has no programme level — cannot decide progression.`,
    );
  }
  const yearOfStudy = (enrolment as unknown as { yearOfStudy?: number }).yearOfStudy ?? 1;

  // Final year detection — the Programme.duration is the canonical signal.
  // We compare against the enrolment's yearOfStudy. When duration is missing
  // (legacy data), treat this as not-final-year — operators can override
  // by passing a programme rule update in a future batch.
  const programmeDuration = (enrolment as unknown as { programme?: { duration?: number } })
    .programme?.duration ?? 0;
  const isFinalYear = programmeDuration > 0 && yearOfStudy >= programmeDuration;

  const passMark = options.passMark ?? DEFAULT_PASS_MARKS[programmeLevel] ?? 40;

  const moduleResults = await moduleResultRepo.findForEnrolmentYear(enrolmentId, academicYear);

  const decisionInput: ProgressionInput = {
    moduleResults: moduleResults.map((r) => ({
      id: r.id,
      moduleId: r.moduleId,
      credits: r.credits,
      aggregateMark: r.aggregateMark,
      isPass:
        r.status === 'CONFIRMED' &&
        ((r.aggregateMark != null && r.aggregateMark >= passMark) ||
          (r.aggregateMark == null && r.grade != null && PASSING_GRADES.has(r.grade))),
    })),
    programmeLevel,
    yearOfStudy,
    isFinalYear,
    rules: options.rules,
  };

  const outcome = decideProgression(decisionInput);

  // Persist path — upsert a ProgressionRecord against the
  // (enrolmentId, academicYear) idempotency key. Refuse to persist when
  // the underlying input was empty unless force=true; the preview path
  // still emits the event so operators can audit a no-data year.
  let persisted = false;
  let progressionRecordId: string | null = null;

  if (options.persist === true) {
    if (outcome.totalCreditsAttempted === 0 && options.force !== true) {
      throw new ValidationError(
        `Cannot persist progression decision for enrolment ${enrolmentId}, year ${academicYear}: ` +
          `no credit-bearing module results found. Re-run with force: true to persist anyway.`,
      );
    }
    const existing = await repo.findByEnrolmentAndYear(enrolmentId, academicYear);
    if (existing) {
      const updated = await update(
        existing.id,
        {
          progressionDecision: outcome.decision as Prisma.ProgressionRecordUpdateInput['progressionDecision'],
          totalCreditsAttempted: outcome.totalCreditsAttempted,
          totalCreditsPassed: outcome.totalCreditsPassed,
          averageMark: outcome.averageMark ?? null,
          decisionDate: new Date(),
        } as Prisma.ProgressionRecordUpdateInput,
        userId,
        req,
      );
      progressionRecordId = updated.id;
    } else {
      const created = await create(
        {
          enrolmentId,
          academicYear,
          yearOfStudy,
          totalCreditsAttempted: outcome.totalCreditsAttempted,
          totalCreditsPassed: outcome.totalCreditsPassed,
          averageMark: outcome.averageMark ?? null,
          progressionDecision: outcome.decision as Prisma.ProgressionRecordUncheckedCreateInput['progressionDecision'],
          decisionDate: new Date(),
        } as Prisma.ProgressionRecordUncheckedCreateInput,
        userId,
        req,
      );
      progressionRecordId = created.id;
    }
    persisted = true;
  }

  await logAudit(
    'Enrolment',
    enrolmentId,
    'UPDATE',
    userId,
    null,
    {
      academicYear,
      yearOfStudy,
      decision: outcome.decision,
      reason: outcome.reason,
      persisted,
      progressionRecordId,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'progressions.decided',
    entityType: 'Enrolment',
    entityId: enrolmentId,
    actorId: userId,
    data: {
      enrolmentId,
      academicYear,
      yearOfStudy,
      programmeLevel,
      isFinalYear,
      decision: outcome.decision,
      totalCreditsAttempted: outcome.totalCreditsAttempted,
      totalCreditsPassed: outcome.totalCreditsPassed,
      averageMark: outcome.averageMark,
      reason: outcome.reason,
      failedModuleIds: outcome.failedModuleIds,
      compensatedModuleIds: outcome.compensatedModuleIds,
      persisted,
      progressionRecordId,
      passMark,
      force: options.force === true,
    },
  });

  return {
    ...outcome,
    enrolmentId,
    academicYear,
    yearOfStudy,
    programmeLevel,
    isFinalYear,
    persisted,
    progressionRecordId,
  };
}
