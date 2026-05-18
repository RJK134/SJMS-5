import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/assessmentAttempt.repository';
import * as assessmentRepo from '../../repositories/assessment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import * as moduleRegistrationRepo from '../../repositories/moduleRegistration.repository';
import * as moduleResultsService from '../module-results/module-results.service';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { resolveGradeFromMark } from '../../utils/grade-boundaries';
import { aggregateMarks, type AttemptForAggregation } from '../../utils/marks-aggregation';

// ── Lifecycle state machine (Phase 17A) ───────────────────────────────────
//
// Canonical transition graph for AssessmentAttempt.status. Mirrors the
// Phase 13b pattern in appeals.service.ts and the Phase 16A pattern in
// applications.service.ts. The schema enum (prisma/schema.prisma:290)
// is the source of truth: PENDING | SUBMITTED | MARKED | MODERATED |
// CONFIRMED | REFERRED | DEFERRED.
//
// CONFIRMED is a TERMINAL state. Once an attempt is confirmed by an exam
// board, the row is immutable in lifecycle terms — any post-confirmation
// correction (plagiarism finding, missed mark, board decision overturned)
// must be expressed as a fresh AssessmentAttempt row, not by re-marking
// the existing one. This protects the "confirmed marks are immutable"
// guarantee that auditors and exam-board minutes assume.
//
// REFERRED and DEFERRED are explicit cycle states. Both flow back to
// SUBMITTED on resit / late submission, then progress through the graph
// again as a separate attempt instance.
type AttemptStatusName =
  | 'PENDING'
  | 'SUBMITTED'
  | 'MARKED'
  | 'MODERATED'
  | 'CONFIRMED'
  | 'REFERRED'
  | 'DEFERRED';

const VALID_ATTEMPT_TRANSITIONS: Record<AttemptStatusName, readonly AttemptStatusName[]> = {
  PENDING: ['SUBMITTED', 'DEFERRED'],
  SUBMITTED: ['MARKED', 'DEFERRED'],
  MARKED: ['MODERATED', 'DEFERRED'],
  MODERATED: ['CONFIRMED', 'REFERRED', 'DEFERRED'],
  CONFIRMED: [], // terminal — no outgoing transitions
  REFERRED: ['SUBMITTED'],
  DEFERRED: ['SUBMITTED'],
};

function assertValidAttemptTransition(from: AttemptStatusName, to: AttemptStatusName): void {
  const allowed = VALID_ATTEMPT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ValidationError(`Invalid attempt status transition: ${from} → ${to}`);
  }
}

/**
 * Pulls the destination status off a Prisma update payload, handling both
 * the bare-value form `{status: 'MARKED'}` and the wrapped form
 * `{status: {set: 'MARKED'}}`. Returns undefined if status is absent.
 */
function extractIncomingStatus(field: Prisma.AssessmentAttemptUpdateInput['status']): string | undefined {
  if (field === undefined) return undefined;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'set' in field) {
    const set = (field as { set?: string }).set;
    return typeof set === 'string' ? set : undefined;
  }
  return undefined;
}

/** Validate that rawMark and finalMark do not exceed the assessment's maxMark. */
async function validateMarkBounds(assessmentId: string, rawMark?: number | null, finalMark?: number | null, moderatedMark?: number | null): Promise<void> {
  if (rawMark == null && finalMark == null && moderatedMark == null) return;
  const assessment = await assessmentRepo.getById(assessmentId);
  if (!assessment) throw new NotFoundError('Assessment', assessmentId);
  const max = assessment.maxMark != null ? Number(assessment.maxMark) : null;
  if (max == null) return;
  if (rawMark != null && Number(rawMark) > max) {
    throw new ValidationError(`rawMark (${rawMark}) exceeds assessment maximum of ${max}`);
  }
  if (finalMark != null && Number(finalMark) > max) {
    throw new ValidationError(`finalMark (${finalMark}) exceeds assessment maximum of ${max}`);
  }
  if (moderatedMark != null && Number(moderatedMark) > max) {
    throw new ValidationError(`moderatedMark (${moderatedMark}) exceeds assessment maximum of ${max}`);
  }
}

// ── Moderation business rules (Phase 17B) ────────────────────────────────────
//
// Layer on top of the Phase 17A state machine. The transition graph already
// rejects illegal status hops; this layer adds the substantive rules every
// UK HE quality framework expects on top of the bare graph:
//
//   1. Independence — the moderator must not be the same user who marked
//      the attempt. This is the single most-common moderation policy
//      requirement in published academic regulations.
//   2. Required fields — moderating an attempt without recording a
//      moderatedMark, or ratifying without a finalMark, is a workflow
//      defect; both are rejected at the service boundary.
//   3. finalMark resolution — when ratifying without an explicit finalMark
//      we derive it from the moderatedMark (or rawMark as the last resort,
//      for assessments with no moderation step). This avoids the "ratified
//      with no recorded outcome" failure mode that the previous CRUD
//      surface allowed.
//   4. Audit-field auto-stamping — markedDate / markedBy / moderatedDate /
//      moderatedBy are stamped on the corresponding transition when the
//      caller has not supplied them. Mirrors the Phase 16A
//      decisionDate / decisionBy stamping pattern on Application.
//
// Each helper accepts the existing payload + previous row + the userId who
// is driving the mutation, and returns nothing — they mutate the payload
// (or throw) so the existing update() flow can keep its single
// repo.update(id, data) call site.

/**
 * Pulls a numeric value off either the bare `value` form or the wrapped
 * `{set: value}` form Prisma uses for nullable Decimal fields. Returns
 * undefined when the field was not supplied at all (so the caller can
 * distinguish "not changing" from "explicitly setting null").
 */
function extractIncomingNumber(
  field: Prisma.AssessmentAttemptUpdateInput['rawMark' | 'moderatedMark' | 'finalMark'] | undefined,
): number | null | undefined {
  if (field === undefined) return undefined;
  if (field === null) return null;
  if (typeof field === 'number') return field;
  if (typeof field === 'object' && field !== null && 'set' in field) {
    const set = (field as { set?: unknown }).set;
    if (set === null) return null;
    if (typeof set === 'number') return set;
    // Handle {set: Decimal} — Prisma wraps Decimal columns in the set form too.
    const setAsDecimal = set as { toNumber?: () => number };
    if (typeof setAsDecimal.toNumber === 'function') {
      return setAsDecimal.toNumber();
    }
  }
  // Decimal can also be a Prisma Decimal instance in bare form — coerce.
  const fieldAsDecimal = field as { toNumber?: () => number };
  if (typeof fieldAsDecimal.toNumber === 'function') {
    return fieldAsDecimal.toNumber();
  }
  return undefined;
}

/** Extract a string value off either the bare or wrapped Prisma update form. */
function extractIncomingString(field: unknown): string | null | undefined {
  if (field === undefined) return undefined;
  if (field === null) return null;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null && 'set' in field) {
    const set = (field as { set?: string | null }).set;
    if (set === null) return null;
    if (typeof set === 'string') return set;
  }
  return undefined;
}

/**
 * Phase 17B — moderator independence. The moderator on an attempt must
 * not be the same user who marked it. Applies whenever moderatedBy is
 * being introduced or changed: either the patch sets moderatedBy, or it
 * sets the status to MODERATED (in which case we will auto-stamp the
 * mutating user as moderatedBy if the caller did not supply one). The
 * comparison runs against the effective markedBy on the row after the
 * patch is applied — i.e. taking any same-payload markedBy override
 * into account.
 */
function assertModeratorIsIndependent(
  effectiveMarkedBy: string | null | undefined,
  effectiveModeratedBy: string | null | undefined,
): void {
  if (
    effectiveModeratedBy &&
    effectiveMarkedBy &&
    effectiveModeratedBy === effectiveMarkedBy
  ) {
    throw new ValidationError(
      `Moderator must be independent of the marker: moderatedBy (${effectiveModeratedBy}) cannot equal markedBy.`,
    );
  }
}

/**
 * Phase 17B — required-field guard for the MARKED → MODERATED transition.
 * A moderation event without a recorded moderatedMark is a workflow defect
 * (the moderator either agreed with the rawMark — in which case the rule is
 * to write rawMark into moderatedMark explicitly — or did not, in which
 * case a moderatedMark is required to capture the disagreement).
 */
function assertModerationHasMark(
  previous: { moderatedMark: unknown },
  effectiveModeratedMark: number | null | undefined,
): void {
  // The patch supplied a moderatedMark explicitly — accept.
  if (effectiveModeratedMark !== undefined && effectiveModeratedMark !== null) return;
  // The row already has a moderatedMark recorded from a previous patch — accept.
  // Reject an explicit null clear — caller actively removing moderatedMark is a workflow defect.
  if (effectiveModeratedMark === null) {
    throw new ValidationError(
      'Cannot explicitly clear moderatedMark on a MODERATED transition. ' +
      'Provide a valid moderatedMark value.',
    );
  }
  if (previous.moderatedMark != null) return;
  throw new ValidationError(
    'Cannot transition AssessmentAttempt to MODERATED without a moderatedMark. ' +
      'Record the moderator decision via {moderatedMark, status: "MODERATED"}.',
  );
}

/**
 * Phase 17B — required-field guard for the MODERATED → CONFIRMED
 * transition. Returns the resolved finalMark for the caller to merge into
 * the patch (auto-derivation from moderatedMark, falling back to rawMark
 * for non-moderated assessments). Throws when no source mark is available.
 *
 * `incomingModeratedMark` and `incomingRawMark` are the effective values
 * extracted from the current patch (may differ from `previous` when the
 * caller sends moderatedMark / rawMark in the same payload as
 * `status: 'CONFIRMED'`). They take priority over the persisted row values
 * so that a combined "set mark + ratify" patch resolves correctly.
 */
function resolveRatifiedFinalMark(
  previous: { finalMark: unknown; moderatedMark: unknown; rawMark: unknown },
  effectiveFinalMark: number | null | undefined,
  incomingModeratedMark: number | null | undefined,
  incomingRawMark: number | null | undefined,
): number {
  // Caller supplied an explicit finalMark — use it.
  if (typeof effectiveFinalMark === 'number') return effectiveFinalMark;
  // The row already has a finalMark — keep it.
  if (previous.finalMark != null) return Number(previous.finalMark);
  // Prefer the incoming moderatedMark from the same patch (caller may be
  // setting both moderatedMark and status: CONFIRMED in one request).
  if (typeof incomingModeratedMark === 'number') return incomingModeratedMark;
  // Fall back to the persisted moderatedMark.
  if (previous.moderatedMark != null) return Number(previous.moderatedMark);
  // Non-moderated path — prefer incoming rawMark, then persisted rawMark.
  if (typeof incomingRawMark === 'number') return incomingRawMark;
  if (previous.rawMark != null) return Number(previous.rawMark);
  throw new ValidationError(
    'Cannot transition AssessmentAttempt to CONFIRMED without a finalMark, ' +
      'moderatedMark, or rawMark to derive it from.',
  );
}

export interface MarkListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  studentId?: string;
  assessmentId?: string;
  moduleRegistrationId?: string;
  attemptNumber?: number;
  status?: string;
}

export async function list(query: MarkListQuery) {
  const { cursor, limit, sort, order, studentId, assessmentId, moduleRegistrationId, attemptNumber, status } = query;
  return repo.list(
    { studentId, assessmentId, moduleRegistrationId, attemptNumber, status },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('AssessmentAttempt', id);
  return result;
}

export async function create(data: Prisma.AssessmentAttemptUncheckedCreateInput, userId: string, req: Request) {
  await validateMarkBounds(
    data.assessmentId,
    extractIncomingNumber(data.rawMark as Prisma.AssessmentAttemptUpdateInput['rawMark']),
    extractIncomingNumber(data.finalMark as Prisma.AssessmentAttemptUpdateInput['finalMark']),
    extractIncomingNumber(data.moderatedMark as Prisma.AssessmentAttemptUpdateInput['moderatedMark']),
  );

  if (data.finalMark != null && !data.grade && data.assessmentId) {
    const autoGrade = await resolveGradeFromMark(data.assessmentId, Number(data.finalMark));
    if (autoGrade) {
      data.grade = autoGrade;
    }
  }

  const result = await repo.create(data);
  await logAudit('AssessmentAttempt', result.id, 'CREATE', userId, null, result, req);
  const createEventMap: Record<string, string> = {
    SUBMITTED: 'marks.submitted',
    PENDING: 'marks.created',
    GRADED: 'marks.graded',
    RATIFIED: 'marks.ratified',
  };
  const createEvent = createEventMap[result.status] ?? 'marks.created';
  emitEvent({
    event: createEvent,
    entityType: 'AssessmentAttempt',
    entityId: result.id,
    actorId: userId,
    data: {
      assessmentId: result.assessmentId,
      moduleRegistrationId: result.moduleRegistrationId,
      attemptNumber: result.attemptNumber,
      status: result.status,
    },
  });
  return result;
}

export async function update(id: string, data: Prisma.AssessmentAttemptUpdateInput, userId: string, req: Request) {
  const previous = await getById(id);

  // Phase 17A — enforce the canonical attempt status transition graph.
  // Only runs when the caller actually supplies a status field and the
  // value differs from the existing record. No-op on every other path,
  // so unrelated update calls (e.g. mark adjustments without status
  // change) are unaffected.
  const incomingStatus = extractIncomingStatus(data.status);
  const transitioning = incomingStatus !== undefined && incomingStatus !== previous.status;

  // Terminal-state protection: an explicit CONFIRMED payload on an already-CONFIRMED
  // row skips `transitioning` and would bypass the graph guard — reject so ratify/PATCH
  // cannot no-op through (mirrors `ratifyModuleResult` in module-results.service).
  if (
    incomingStatus !== undefined &&
    incomingStatus === previous.status &&
    previous.status === 'CONFIRMED'
  ) {
    throw new ValidationError(`Invalid attempt status transition: ${previous.status} → ${incomingStatus}`);
  }

  if (transitioning) {
    assertValidAttemptTransition(
      previous.status as AttemptStatusName,
      incomingStatus as AttemptStatusName,
    );
  }

  // ── Phase 17B — moderation business rules ──────────────────────────────
  //
  // Layered on top of the 17A transition graph. The graph already says
  // "you may move MARKED → MODERATED"; this layer adds "and the moderator
  // is independent of the marker, and a moderatedMark is recorded".
  //
  // We compute the effective post-patch values up front so the same
  // payload object can drive both the rule check and the final
  // repo.update call. Auto-stamping mutates the payload in place (just
  // like the Phase 16A applications.update pattern).
  const incomingMarkedBy = extractIncomingString(data.markedBy);
  const effectiveMarkedBy =
    incomingMarkedBy === undefined
      ? (previous as { markedBy?: string | null }).markedBy ?? null
      : incomingMarkedBy;
  const incomingModeratedBy = extractIncomingString(data.moderatedBy);
  const effectiveModeratedMark = extractIncomingNumber(data.moderatedMark);
  const effectiveFinalMark = extractIncomingNumber(data.finalMark);
  // Needed to pass as fallback to resolveRatifiedFinalMark when the caller
  // sets rawMark and status: CONFIRMED in the same patch.
  const effectiveIncomingRawMark = extractIncomingNumber(data.rawMark);

  if (transitioning) {
    if (incomingStatus === 'MARKED') {
      // Auto-stamp markedDate / markedBy if the caller did not supply
      // them. This mirrors the Phase 16A decisionDate / decisionBy
      // stamping on Application — workflow-driven status flips inherit
      // sensible audit metadata without forcing every caller to repeat
      // the same boilerplate.
      if (data.markedDate === undefined) data.markedDate = new Date();
      if (data.markedBy === undefined) {
        data.markedBy = userId;
      }
    }

    if (incomingStatus === 'MODERATED') {
      // Required-field guard — moderation needs a recorded moderatedMark.
      assertModerationHasMark(previous as { moderatedMark: unknown }, effectiveModeratedMark);

      // Determine effective moderator: explicit patch value wins, otherwise
      // fall back to the authenticated user. Mirrors the effectiveMarkedBy
      // pattern above and lets callers attribute the action explicitly.
      const effectiveModeratedBy =
        incomingModeratedBy === undefined ? userId : incomingModeratedBy;

      // Auto-stamp moderatedDate / moderatedBy when not supplied.
      if (data.moderatedDate === undefined) data.moderatedDate = new Date();
      if (data.moderatedBy === undefined) {
        data.moderatedBy = userId;
      }

      // Independence — the effective moderator must not be the effective marker.
      assertModeratorIsIndependent(effectiveMarkedBy, effectiveModeratedBy);
    }

    if (incomingStatus === 'CONFIRMED') {
      // Auto-derive finalMark from moderatedMark / rawMark if not supplied,
      // so callers do not have to round-trip the value themselves. Pass the
      // effective incoming marks so a combined "set mark + ratify" patch
      // (e.g. moderatedMark + status: CONFIRMED in one request) resolves
      // correctly rather than falling back to the stale persisted values.
      const resolved = resolveRatifiedFinalMark(
        previous as { finalMark: unknown; moderatedMark: unknown; rawMark: unknown },
        effectiveFinalMark,
        effectiveModeratedMark,
        effectiveIncomingRawMark,
      );
      const finalMarkExplicitlyCleared =
        data.finalMark === null ||
        (typeof data.finalMark === 'object' &&
          data.finalMark !== null &&
          'set' in data.finalMark &&
          (data.finalMark as { set: unknown }).set === null);
      if (data.finalMark === undefined || finalMarkExplicitlyCleared) {
        data.finalMark = resolved;
      }
    }
  } else if (incomingModeratedBy !== undefined) {
    // Independence guard also runs on a moderatedBy-only patch (i.e. a
    // correction to the moderator field after MODERATED has been recorded).
    assertModeratorIsIndependent(effectiveMarkedBy, incomingModeratedBy);
  }

  const reassignedId = data.assessment && typeof data.assessment === 'object' && 'connect' in data.assessment
    ? (data.assessment as { connect: { id: string } }).connect.id
    : undefined;
  const effectiveAssessmentId = reassignedId ?? previous.assessmentId;
  await validateMarkBounds(
    effectiveAssessmentId,
    extractIncomingNumber(data.rawMark),
    extractIncomingNumber(data.finalMark),
    extractIncomingNumber(data.moderatedMark),
  );

  if (data.finalMark != null && !data.grade && effectiveAssessmentId) {
    const autoGrade = await resolveGradeFromMark(
      effectiveAssessmentId,
      typeof data.finalMark === 'object' && 'set' in data.finalMark
        ? Number(data.finalMark.set)
        : Number(data.finalMark),
    );
    if (autoGrade) {
      data.grade = autoGrade;
    }
  }

  const result = await repo.update(id, data);
  await logAudit('AssessmentAttempt', id, 'UPDATE', userId, previous, result, req);

  // Map AttemptStatus transitions to domain-specific marks events,
  // plus an additive marks.status_changed event on every valid transition
  // (Phase 17A — gives n8n a single subscription point for any transition).
  if (result.status !== previous.status) {
    const statusEventMap: Record<string, string> = {
      SUBMITTED: 'marks.submitted',
      MODERATED: 'marks.moderated',
      CONFIRMED: 'marks.ratified',
    };
    const specificEvent = statusEventMap[result.status];
    const transitionPayload = {
      assessmentId: result.assessmentId,
      moduleRegistrationId: result.moduleRegistrationId,
      attemptNumber: result.attemptNumber,
      rawMark: result.rawMark != null ? Number(result.rawMark) : null,
      moderatedMark: result.moderatedMark != null ? Number(result.moderatedMark) : null,
      finalMark: result.finalMark != null ? Number(result.finalMark) : null,
      grade: result.grade,
      previousStatus: previous.status,
      newStatus: result.status,
    };
    if (specificEvent) {
      emitEvent({
        event: specificEvent,
        entityType: 'AssessmentAttempt',
        entityId: id,
        actorId: userId,
        data: transitionPayload,
      });
    }
    emitEvent({
      event: 'marks.status_changed',
      entityType: 'AssessmentAttempt',
      entityId: id,
      actorId: userId,
      data: transitionPayload,
    });
  }

  // marks.released: finalMark and grade populated for the first time
  // (typically after exam board ratification confirms the result)
  if (
    result.finalMark != null &&
    result.grade != null &&
    (previous.finalMark == null || previous.grade == null)
  ) {
    emitEvent({
      event: 'marks.released',
      entityType: 'AssessmentAttempt',
      entityId: id,
      actorId: userId,
      data: {
        assessmentId: result.assessmentId,
        moduleRegistrationId: result.moduleRegistrationId,
        finalMark: Number(result.finalMark),
        grade: result.grade,
        outcome: result.status,
      },
    });
  }

  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('AssessmentAttempt', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'marks.deleted',
    entityType: 'AssessmentAttempt',
    entityId: id,
    actorId: userId,
    data: {
      assessmentId: previous.assessmentId,
      moduleRegistrationId: previous.moduleRegistrationId,
      status: 'DELETED',
    },
  });
}

// ── Marks aggregation (Phase 17A) ────────────────────────────────────────────
//
// Rolls AssessmentAttempt rows up into a module-level aggregate using the
// canonical weighted-average rule in `utils/marks-aggregation`. The shape is
// deliberately simple: one moduleRegistration in, one aggregate result out.
// 17C / 17D will layer module result generation and classification on top of
// this primitive without re-implementing the maths.
//
// Two operating modes:
//
//   preview  (default)  — compute the aggregate, do NOT touch ModuleResult.
//                         Used by the cohort-preview UI and by test runs.
//                         Audit + a `marks.aggregated` event are still
//                         emitted (with `persisted: false`) so the operation
//                         is observable end-to-end.
//   persist  (opt-in)   — additionally upsert the ModuleResult row through
//                         module-results.service so its existing audit /
//                         events (`module_results.created` /
//                         `module_results.updated`) fire on their normal
//                         path. Refuses to persist when `isComplete=false`
//                         to keep "definitive" results honest; the operator
//                         can re-run with `force: true` to override.
//
// Status filter:
//   By default only CONFIRMED attempts contribute, matching UK HE practice
//   that pre-board / unmoderated marks should not feed a definitive aggregate.
//   The caller can widen this to MARKED / MODERATED for a pre-board preview
//   via `attemptStatuses`.
//
// Grade resolution:
//   Per-module grade boundaries do not exist in the current schema (only
//   per-Assessment boundaries via `GradeBoundary`). When the caller supplies
//   `boundaryAssessmentId`, the aggregate is resolved against that
//   assessment's GradeBoundary set; otherwise grade is null and full
//   classification logic is deferred to 17D.

const DEFAULT_AGGREGATION_STATUSES: ReadonlyArray<AttemptStatusName> = ['CONFIRMED'];

const FULL_WEIGHTING_TOTAL = 100;

export interface AggregationOptions {
  /** AssessmentAttempt statuses that contribute to the aggregate. Defaults to ['CONFIRMED']. */
  attemptStatuses?: ReadonlyArray<AttemptStatusName>;
  /**
   * When supplied, the aggregate percentage is resolved to a grade against
   * this assessment's GradeBoundary set. Most institutions configure the
   * same boundary set on every assessment within a module, so any
   * assessment id from the module is acceptable. Omit to leave grade null
   * (17D will introduce module-level boundaries proper).
   */
  boundaryAssessmentId?: string;
  /** Persist the aggregate to ModuleResult. Defaults to false (preview only). */
  persist?: boolean;
  /**
   * Persist even when the aggregation is incomplete (missing components).
   * No effect unless `persist: true`. Operator override for the preview-only
   * default; the resulting ModuleResult is still PROVISIONAL and the
   * audit/event payload records `force: true` so it is traceable.
   */
  force?: boolean;
}

export interface AggregationOutcome {
  moduleRegistrationId: string;
  moduleId: string;
  academicYear: string;
  aggregatePercentage: number | null;
  grade: string | null;
  totalWeighting: number;
  componentCount: number;
  contributingCount: number;
  isComplete: boolean;
  missingAssessmentIds: string[];
  /** True iff the aggregate was written to ModuleResult on this call. */
  persisted: boolean;
  /** Set when persisted; null when previewed. */
  moduleResultId: string | null;
}

/**
 * Aggregate the AssessmentAttempt rows for a single ModuleRegistration into
 * a module-level result. See the block comment above for behaviour. Pure
 * arithmetic is delegated to `utils/marks-aggregation.aggregateMarks`; this
 * function is the I/O orchestrator.
 *
 * @throws NotFoundError when the moduleRegistration does not exist.
 * @throws ValidationError when `persist: true` is requested but the
 *   aggregation is incomplete (and `force: true` was not also supplied),
 *   or when no contributing attempts were found.
 */
export async function aggregateForModuleRegistration(
  moduleRegistrationId: string,
  options: AggregationOptions,
  userId: string,
  req: Request,
): Promise<AggregationOutcome> {
  const moduleRegistration = await moduleRegistrationRepo.getById(moduleRegistrationId);
  if (!moduleRegistration) {
    throw new NotFoundError('ModuleRegistration', moduleRegistrationId);
  }

  const attemptStatuses = options.attemptStatuses ?? DEFAULT_AGGREGATION_STATUSES;
  const projection = await repo.findForAggregation(moduleRegistrationId, {
    statuses: attemptStatuses,
  });

  const attempts: AttemptForAggregation[] = projection.map((p) => ({
    assessmentId: p.assessmentId,
    finalMark: p.finalMark,
    maxMark: p.maxMark,
    weighting: p.weighting,
  }));

  const aggregation = aggregateMarks(attempts);

  // Grade resolution against the optional boundary assessment. Any failure
  // here (missing boundaries, mark out of range) returns null — callers can
  // distinguish "no boundaries supplied" from "boundaries didn't match" by
  // inspecting the input options vs the output grade.
  let grade: string | null = null;
  if (aggregation.aggregatePercentage != null && options.boundaryAssessmentId) {
    grade = await resolveGradeFromMark(
      options.boundaryAssessmentId,
      aggregation.aggregatePercentage,
    );
  }

  const wantsPersist = options.persist === true;
  if (wantsPersist) {
    if (aggregation.contributingCount === 0) {
      throw new ValidationError(
        `Cannot persist aggregation for moduleRegistrationId ${moduleRegistrationId}: ` +
          `no contributing AssessmentAttempt rows in statuses [${attemptStatuses.join(', ')}].`,
      );
    }
    if (!aggregation.isComplete && options.force !== true) {
      const detail =
        aggregation.missingAssessmentIds.length > 0
          ? `${aggregation.missingAssessmentIds.length} component(s) missing finalMark. `
          : 'One or more components did not contribute (for example ineligible maxMark or weighting). ';
      throw new ValidationError(
        `Cannot persist incomplete aggregation for moduleRegistrationId ${moduleRegistrationId}: ` +
          detail +
          `Re-run with force: true to override (result will remain PROVISIONAL).`,
      );
    }
    if (aggregation.totalWeighting !== FULL_WEIGHTING_TOTAL && options.force !== true) {
      throw new ValidationError(
        `Cannot persist aggregation for moduleRegistrationId ${moduleRegistrationId}: ` +
          `total contributing weighting is ${aggregation.totalWeighting}, expected ${FULL_WEIGHTING_TOTAL}. ` +
          `Re-run with force: true to override.`,
      );
    }
  }

  let moduleResultId: string | null = null;
  let persisted = false;

  if (wantsPersist) {
    const existing = await moduleResultRepo.findByModuleRegistrationAndYear(
      moduleRegistrationId,
      moduleRegistration.academicYear,
    );

    if (existing) {
      // Refuse to overwrite a CONFIRMED ModuleResult — that violates the
      // immutability guarantee documented in module-results.service. The
      // 17B status guard would also reject any status flip here, but
      // catching it explicitly gives the caller a clearer error.
      if (existing.status === 'CONFIRMED') {
        throw new ValidationError(
          `Cannot re-aggregate over CONFIRMED ModuleResult ${existing.id}: ` +
            `confirmed module results are immutable. Create a fresh ModuleResult instead.`,
        );
      }
      const updated = await moduleResultsService.update(
        existing.id,
        {
          aggregateMark: aggregation.aggregatePercentage,
          ...(grade != null ? { grade } : {}),
        } as Prisma.ModuleResultUpdateInput,
        userId,
        req,
      );
      moduleResultId = updated.id;
    } else {
      const created = await moduleResultsService.create(
        {
          moduleRegistrationId,
          moduleId: moduleRegistration.moduleId,
          academicYear: moduleRegistration.academicYear,
          aggregateMark: aggregation.aggregatePercentage ?? null,
          grade,
          status: 'PROVISIONAL',
        } as Prisma.ModuleResultUncheckedCreateInput,
        userId,
        req,
      );
      moduleResultId = created.id;
    }
    persisted = true;
  }

  const outcome: AggregationOutcome = {
    moduleRegistrationId,
    moduleId: moduleRegistration.moduleId,
    academicYear: moduleRegistration.academicYear,
    aggregatePercentage: aggregation.aggregatePercentage,
    grade,
    totalWeighting: aggregation.totalWeighting,
    componentCount: aggregation.componentCount,
    contributingCount: aggregation.contributingCount,
    isComplete: aggregation.isComplete,
    missingAssessmentIds: aggregation.missingAssessmentIds,
    persisted,
    moduleResultId,
  };

  // Audit action is UPDATE rather than a bespoke 'AGGREGATE' value: the
  // canonical AuditAction enum is {CREATE, UPDATE, DELETE, VIEW, EXPORT}
  // and aggregation is semantically a derived-state update against the
  // moduleRegistration row. The before/after pair captures what changed.
  await logAudit(
    'ModuleRegistration',
    moduleRegistrationId,
    'UPDATE',
    userId,
    null,
    outcome as unknown as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'marks.aggregated',
    entityType: 'ModuleRegistration',
    entityId: moduleRegistrationId,
    actorId: userId,
    data: {
      moduleId: outcome.moduleId,
      academicYear: outcome.academicYear,
      aggregatePercentage: outcome.aggregatePercentage,
      grade: outcome.grade,
      totalWeighting: outcome.totalWeighting,
      contributingCount: outcome.contributingCount,
      componentCount: outcome.componentCount,
      isComplete: outcome.isComplete,
      missingAssessmentIds: outcome.missingAssessmentIds,
      persisted: outcome.persisted,
      moduleResultId: outcome.moduleResultId,
      attemptStatuses,
      boundaryAssessmentId: options.boundaryAssessmentId ?? null,
      force: options.force === true,
    },
  });

  return outcome;
}

// ── Moderation / ratification action endpoints (Phase 17B) ───────────────────
//
// Action-named wrappers that drive the canonical state-machine transitions.
// They route through update() rather than touching the repository directly,
// so the existing transition guard, moderation rules, audit, and event
// emission all fire on their normal path. Workflow tools (n8n, the staff
// portal) get a clear "moderate this attempt" / "ratify this attempt" verb
// to subscribe to instead of having to reverse-engineer status flips out
// of generic PATCH calls.

/** Input shape for `moderateAttempt`. */
export interface ModerateAttemptInput {
  moderatedMark: number;
  feedback?: string;
  moderatedBy?: string;
}

/** Input shape for `ratifyAttempt`. */
export interface RatifyAttemptInput {
  finalMark?: number;
  grade?: string;
}

/**
 * POST /v1/marks/:id/moderate handler.
 *
 * Drives the MARKED → MODERATED transition. Records the moderatedMark
 * (required), optional feedback, and stamps moderatedDate / moderatedBy.
 * If the attempt is not currently in MARKED status, the underlying
 * transition guard will reject the call with the canonical error.
 */
export async function moderateAttempt(
  id: string,
  input: ModerateAttemptInput,
  userId: string,
  req: Request,
) {
  const patch: Prisma.AssessmentAttemptUpdateInput = {
    status: 'MODERATED',
    moderatedMark: input.moderatedMark,
    ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
    ...(input.moderatedBy !== undefined ? { moderatedBy: input.moderatedBy } : {}),
  };
  return update(id, patch, userId, req);
}

/**
 * POST /v1/marks/:id/ratify handler.
 *
 * Drives the MODERATED → CONFIRMED transition. finalMark / grade are
 * optional — `update()` auto-derives finalMark from moderatedMark
 * (or rawMark) and auto-resolves grade against the Assessment's
 * GradeBoundary set when not supplied. Idempotent in the lifecycle sense:
 * once CONFIRMED, the row is terminal and any further ratify call will
 * be rejected in update() (explicit CONFIRMED on a CONFIRMED row — same pattern as
 * `ratifyModuleResult`).
 */
export async function ratifyAttempt(
  id: string,
  input: RatifyAttemptInput,
  userId: string,
  req: Request,
) {
  const patch: Prisma.AssessmentAttemptUpdateInput = {
    status: 'CONFIRMED',
    ...(input.finalMark !== undefined ? { finalMark: input.finalMark } : {}),
    ...(input.grade !== undefined ? { grade: input.grade } : {}),
  };
  return update(id, patch, userId, req);
}

// ── Cohort-level module result generation (Phase 17C) ────────────────────────
//
// Batches the Phase 17A `aggregateForModuleRegistration` primitive across
// every active registration on a given (moduleId, academicYear) cohort.
// Layers the operational rules a real cohort generation needs without
// adding any new business rules — those still belong in 17A / 17B / 17D:
//
//   1. Idempotency at scale: rows whose existing ModuleResult is already
//      CONFIRMED are skipped (the ratified-results immutability guarantee
//      from 17B applies cohort-wide, not just per row).
//   2. Per-row error isolation: one row throwing (incomplete aggregation,
//      missing maxMark on an assessment, etc.) does NOT abort the whole
//      cohort. The thrown error is captured in the per-row outcome and
//      the loop continues. The cohort summary reports `failed` separately
//      from `succeeded`, so the operator sees the real picture rather
//      than a single all-or-nothing exception.
//   3. Preview vs persist parity: the same `persist`/`force`/`attemptStatuses`
//      / `boundaryAssessmentId` options 17A understands are forwarded to
//      every row. Default behaviour — preview only, CONFIRMED-only attempts —
//      mirrors 17A so the safe path is also the default.
//
// Lives in marks.service (not module-results.service) to avoid a circular
// import: marks.service already imports module-results.service for the
// aggregate-persist path. The HTTP endpoint is mounted on the
// module-results router (POST /v1/module-results/generate) for naming
// clarity; the controller imports both services.

/** Per-row outcome from `generateModuleResultsForCohort`. */
export interface CohortRowOutcome {
  moduleRegistrationId: string;
  enrolmentId: string;
  /** 'persisted' or 'previewed' on success, 'skipped' when an existing CONFIRMED row blocks generation, 'failed' on any thrown error. */
  outcome: 'persisted' | 'previewed' | 'skipped' | 'failed';
  /** When outcome is 'persisted' or 'previewed', the underlying aggregation result (mark, grade, completeness flags). Null on failure / skip. */
  aggregation: AggregationOutcome | null;
  /** Reason for skip / failure. Always set when outcome is 'skipped' or 'failed'; null otherwise. */
  reason: string | null;
}

/** Cohort-level summary returned by the generator. */
export interface CohortGenerationOutcome {
  moduleId: string;
  academicYear: string;
  /** Total active rows considered (registrations the repo helper returned). */
  total: number;
  /** Rows whose aggregation produced a result and was persisted to ModuleResult. */
  persisted: number;
  /** Rows whose aggregation produced a result but was previewed (persist=false). */
  previewed: number;
  /** Rows skipped because the existing ModuleResult is already CONFIRMED. */
  skipped: number;
  /** Rows whose aggregation threw — see `results[i].reason` for the message. */
  failed: number;
  /** Per-row breakdown in stable order (registration id ascending). */
  results: CohortRowOutcome[];
}

export interface CohortGenerationOptions {
  /** Forwarded to `aggregateForModuleRegistration` for each row. */
  attemptStatuses?: ReadonlyArray<AttemptStatusName>;
  /** Forwarded to `aggregateForModuleRegistration` for each row. */
  boundaryAssessmentId?: string;
  /** Persist each row's aggregate to ModuleResult. Defaults to false (cohort-wide preview). */
  persist?: boolean;
  /** Force-override incomplete / non-100% aggregations on the persist path. No effect when persist is false. */
  force?: boolean;
}

/**
 * Generate module results for an entire cohort by batch-running
 * `aggregateForModuleRegistration` against every active registration on
 * the (moduleId, academicYear) pair. See the block comment above for the
 * batch semantics. Returns a summary the caller can render directly to
 * an operator without further processing.
 *
 * Per-row errors from `aggregateForModuleRegistration` are captured in
 * `results[i].reason` (an empty cohort returns `total: 0` and `results: []`
 * without treating that as an error). Cohort-level `logAudit` and
 * `emitEvent` are not wrapped: failures there propagate to the HTTP layer
 * as usual.
 */
export async function generateModuleResultsForCohort(
  moduleId: string,
  academicYear: string,
  options: CohortGenerationOptions,
  userId: string,
  req: Request,
): Promise<CohortGenerationOutcome> {
  const cohort = await moduleRegistrationRepo.findActiveForCohort(moduleId, academicYear);

  const results: CohortRowOutcome[] = [];

  for (const row of cohort) {
    // Idempotency: skip rows whose existing ModuleResult is already
    // CONFIRMED. The 17B terminal-state guard would also reject any
    // overwrite via update(), but checking up front gives the operator a
    // clean per-row "skipped — already ratified" outcome rather than a
    // failure-noise message in the summary.
    const existing = await moduleResultRepo.findByModuleRegistrationAndYear(
      row.id,
      academicYear,
    );
    if (existing && existing.status === 'CONFIRMED') {
      results.push({
        moduleRegistrationId: row.id,
        enrolmentId: row.enrolmentId,
        outcome: 'skipped',
        aggregation: null,
        reason: 'ModuleResult already CONFIRMED — ratified results are immutable',
      });
      continue;
    }

    try {
      const aggregation = await aggregateForModuleRegistration(
        row.id,
        {
          ...(options.attemptStatuses !== undefined ? { attemptStatuses: options.attemptStatuses } : {}),
          ...(options.boundaryAssessmentId !== undefined ? { boundaryAssessmentId: options.boundaryAssessmentId } : {}),
          ...(options.persist !== undefined ? { persist: options.persist } : {}),
          ...(options.force !== undefined ? { force: options.force } : {}),
        },
        userId,
        req,
      );
      results.push({
        moduleRegistrationId: row.id,
        enrolmentId: row.enrolmentId,
        outcome: aggregation.persisted ? 'persisted' : 'previewed',
        aggregation,
        reason: null,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown aggregation error';
      results.push({
        moduleRegistrationId: row.id,
        enrolmentId: row.enrolmentId,
        outcome: 'failed',
        aggregation: null,
        reason,
      });
    }
  }

  const summary = results.reduce(
    (counts, result) => {
      if (result.outcome === 'persisted') counts.persisted += 1;
      else if (result.outcome === 'previewed') counts.previewed += 1;
      else if (result.outcome === 'skipped') counts.skipped += 1;
      else if (result.outcome === 'failed') counts.failed += 1;

      return counts;
    },
    { persisted: 0, previewed: 0, skipped: 0, failed: 0 },
  );

  const outcome: CohortGenerationOutcome = {
    moduleId,
    academicYear,
    total: cohort.length,
    persisted: summary.persisted,
    previewed: summary.previewed,
    skipped: summary.skipped,
    failed: summary.failed,
    results,
  };

  // Cohort-level audit + event. Subject is the Module (not individual
  // registrations) — per-row aggregations already audit themselves
  // through aggregateForModuleRegistration / module-results.service when
  // they fire. The cohort entry captures the operator-driven batch as
  // a single auditable action.
  await logAudit(
    'Module',
    moduleId,
    'UPDATE',
    userId,
    null,
    outcome as unknown as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'module_results.batch_generated',
    entityType: 'Module',
    entityId: moduleId,
    actorId: userId,
    data: {
      moduleId,
      academicYear,
      total: outcome.total,
      persisted: outcome.persisted,
      previewed: outcome.previewed,
      skipped: outcome.skipped,
      failed: outcome.failed,
      attemptStatuses: options.attemptStatuses ?? null,
      boundaryAssessmentId: options.boundaryAssessmentId ?? null,
      persistRequested: options.persist === true,
      force: options.force === true,
    },
  });

  return outcome;
}
