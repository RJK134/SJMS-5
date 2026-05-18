import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/awardRecord.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  classifyAward,
  type ClassificationInput,
  type ClassificationOutcome,
  type ClassificationRules,
  type ClassifierProgrammeLevel,
} from '../../utils/award-classification';

export interface AwardListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentId?: string;
  programmeId?: string;
  classification?: string;
}

export async function list(query: AwardListQuery) {
  const { cursor, limit, sort, order, studentId, programmeId, classification } = query;
  return repo.list(
    { studentId, programmeId, classification },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('AwardRecord', id);
  return result;
}

export async function create(data: Prisma.AwardRecordUncheckedCreateInput, userId: string, req: Request) {
  const result = await repo.create(data);
  await logAudit('AwardRecord', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'awards.created',
    entityType: 'AwardRecord',
    entityId: result.id,
    actorId: userId,
    data: { studentId: result.studentId, programmeId: result.programmeId, classification: result.classification },
  });
  return result;
}

export async function update(id: string, data: Prisma.AwardRecordUpdateInput, userId: string, req: Request) {
  const previous = await getById(id);
  const result = await repo.update(id, data);
  await logAudit('AwardRecord', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'awards.updated',
    entityType: 'AwardRecord',
    entityId: id,
    actorId: userId,
    data: { studentId: result.studentId, programmeId: result.programmeId, classification: result.classification },
  });
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('AwardRecord', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'awards.deleted',
    entityType: 'AwardRecord',
    entityId: id,
    actorId: userId,
    data: { studentId: previous.studentId, status: 'DELETED' },
  });
}

// ── Award classification (Phase 17D) ────────────────────────────────────────
//
// Drives the canonical award classification rules engine. Loads every
// CONFIRMED ModuleResult under the enrolment, calls the pure utility
// `classifyAward`, and (optionally) upserts an AwardRecord. Preview vs
// persist parity matches the 17A / 17C / 17D progression-decisioning
// pattern.

/** Inputs accepted by the classifier (forwarded to the pure utility). */
export interface ClassifyAwardOptions {
  /** Rule overrides forwarded to `classifyAward`. */
  rules?: ClassificationRules;
  /** Persist an AwardRecord row. Defaults to false (preview only). */
  persist?: boolean;
  /** Operator override for empty-cohort / no-mark inputs. */
  force?: boolean;
}

/** Outcome returned by the service. */
export interface ClassifyAwardResult extends ClassificationOutcome {
  enrolmentId: string;
  studentId: string;
  programmeId: string;
  programmeLevel: ClassifierProgrammeLevel;
  /** True when an AwardRecord was upserted on this call. */
  persisted: boolean;
  /** Set when persisted; null on preview. */
  awardRecordId: string | null;
}

/**
 * Classify an award outcome for a single enrolment. Pure arithmetic is
 * delegated to `utils/award-classification`; this function is the I/O
 * orchestrator.
 *
 * @throws NotFoundError when the enrolment does not exist.
 */
export async function classifyForEnrolment(
  enrolmentId: string,
  options: ClassifyAwardOptions,
  userId: string,
  req: Request,
): Promise<ClassifyAwardResult> {
  const enrolment = await enrolmentRepo.getById(enrolmentId);
  if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

  const programme = (enrolment as unknown as { programme?: { level?: string; title?: string } }).programme;
  const programmeLevel = programme?.level as ClassifierProgrammeLevel | undefined;
  if (!programmeLevel) {
    throw new ValidationError(
      `Enrolment ${enrolmentId} has no programme level — cannot classify award.`,
    );
  }
  const studentId = (enrolment as unknown as { studentId: string }).studentId;
  const programmeId = (enrolment as unknown as { programmeId: string }).programmeId;

  const moduleResults = await moduleResultRepo.findForEnrolment(enrolmentId, {
    statuses: ['CONFIRMED'],
  });

  const classificationInput: ClassificationInput = {
    moduleResults: moduleResults.map((r) => ({
      id: r.id,
      moduleId: r.moduleId,
      credits: r.credits,
      level: r.level,
      aggregateMark: r.aggregateMark,
    })),
    programmeLevel,
    rules: options.rules,
  };

  const outcome = classifyAward(classificationInput);

  // Persist path — upsert an AwardRecord against the enrolment-level
  // idempotency key. Refuse to persist when no mark contributed unless
  // force=true; the preview path still emits the event.
  let persisted = false;
  let awardRecordId: string | null = null;

  if (options.persist === true) {
    if (outcome.contributingModuleCount === 0 && options.force !== true) {
      throw new ValidationError(
        `Cannot persist award classification for enrolment ${enrolmentId}: ` +
          `no CONFIRMED module results contributed an aggregateMark. ` +
          `Re-run with force: true to persist anyway.`,
      );
    }
    const existing = await repo.findByEnrolment(enrolmentId);
    if (existing) {
      const updated = await update(
        existing.id,
        {
          classification: outcome.classification as Prisma.AwardRecordUpdateInput['classification'],
          finalAverage: outcome.finalAverage ?? null,
          totalCredits: outcome.totalCreditsConsidered,
        } as Prisma.AwardRecordUpdateInput,
        userId,
        req,
      );
      awardRecordId = updated.id;
    } else {
      const created = await create(
        {
          studentId,
          enrolmentId,
          programmeId,
          // Use the programme title as a sensible default award title;
          // operators can override later via PATCH /v1/awards/:id.
          awardTitle: programme?.title ?? 'Award',
          classification: outcome.classification as Prisma.AwardRecordUncheckedCreateInput['classification'],
          finalAverage: outcome.finalAverage ?? null,
          totalCredits: outcome.totalCreditsConsidered,
          status: 'RECOMMENDED',
        } as Prisma.AwardRecordUncheckedCreateInput,
        userId,
        req,
      );
      awardRecordId = created.id;
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
      classification: outcome.classification,
      finalAverage: outcome.finalAverage,
      reason: outcome.reason,
      persisted,
      awardRecordId,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'awards.classified',
    entityType: 'Enrolment',
    entityId: enrolmentId,
    actorId: userId,
    data: {
      enrolmentId,
      studentId,
      programmeId,
      programmeLevel,
      classification: outcome.classification,
      finalAverage: outcome.finalAverage,
      totalCreditsConsidered: outcome.totalCreditsConsidered,
      contributingModuleCount: outcome.contributingModuleCount,
      excludedModuleIds: outcome.excludedModuleIds,
      reason: outcome.reason,
      persisted,
      awardRecordId,
      force: options.force === true,
    },
  });

  return {
    ...outcome,
    enrolmentId,
    studentId,
    programmeId,
    programmeLevel,
    persisted,
    awardRecordId,
  };
}
