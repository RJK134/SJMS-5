import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/secondMarkingRecord.repository';
import * as attemptRepo from '../../repositories/assessmentAttempt.repository';
import * as marksService from './marks.service';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { toNumber, type DecimalLike } from '../../utils/decimal-helpers';

// ── Workstream C3 — Second-marking workflow service ─────────────────────────
//
// Layers a parallel state-machine onto AssessmentAttempt to record the
// second-marking lifecycle. Phase 17B defined the moderation / ratification
// graph (MARKED → MODERATED → CONFIRMED) on the parent AssessmentAttempt;
// this service expresses the orthogonal second-marking lifecycle on the
// dedicated SecondMarkingRecord row:
//
//   ASSIGNED_TO_SECOND → SECOND_MARKED → RECONCILED
//
// The schema's `SecondMarkingRecord` model (prisma/schema.prisma:2606) does
// not carry a `status` column; the state is therefore *derived* from the
// persisted fields rather than persisted directly. The mapping is:
//
//   ASSIGNED_TO_SECOND
//     row exists, completedDate IS NULL, agreedMark IS NULL, and the
//     second mark has not yet been recorded by the assigned marker.
//     The schema requires `secondMarkerMark` to be non-null at creation,
//     so the service initialises it as a *placeholder* equal to
//     `firstMarkerMark` and emits `second_marking.assigned` to record
//     the transition canonically. The persisted shape is intentionally
//     ambiguous (a service-defined sentinel; see `recordSecondMark` for
//     the disambiguation contract) — the state-of-record is the audit
//     trail and the emitted webhook events.
//
//   SECOND_MARKED
//     `recordSecondMark` has fired. `secondMarkerMark` holds the real
//     value; `agreedMark IS NULL`; `completedDate IS NULL`; the
//     `second_marking.recorded` event has been emitted on this id.
//
//   RECONCILED
//     `completedDate IS NOT NULL` AND `agreedMark IS NOT NULL`. Both
//     fields are set in the same patch on the reconciliation transition.
//
// Why a derived status rather than a schema migration:
//   The Workstream C3 brief is explicit: "Do NOT modify the schema. If a
//   field is missing, scope the feature down or use a sensible default."
//   The derived-status approach lets the workflow ship behind backend-only
//   changes and avoids a migration that would need to backfill historical
//   rows — a schema-migration route is sequenced for a later batch
//   alongside the ModerationQueue UI work.
//
// Independence guard:
//   Mirrors Phase 17B's moderator-marker independence. The assigned
//   secondMarkerId MUST differ from the parent AssessmentAttempt's
//   markedBy. The guard runs at assignment time and again on `recordSecondMark`
//   (the latter rejects a recording call from a user other than the
//   assigned secondMarker, preventing back-channel mark substitution).
//
// Reconciliation policy:
//   The default tolerance is 5 percentage points (the prevailing UK HE
//   threshold below which first/second markers are deemed in agreement
//   and the average is auto-accepted). Above the tolerance, the service
//   does NOT auto-accept; instead it emits `second_marking.requires_third_marker`
//   so a Workstream C follow-on can wire the third-marker workflow.
//   The tolerance is supplied per-call (no schema column) — defaults to
//   the constant below.
//
//   When a reconciliation does succeed (auto-accepted average OR an
//   explicit operator-supplied `reconciledMark`), the resulting agreed
//   mark is propagated back onto the parent AssessmentAttempt's
//   `moderatedMark` via marks.service.update so the Phase 17B audit /
//   `marks.status_changed` events fire on their normal path. The propagation
//   is best-effort: a failure to update the parent attempt does NOT roll
//   back the SecondMarkingRecord reconciliation (the record itself is the
//   academic-governance source of truth; the attempt update is a
//   convenience for downstream aggregation).

/** Default reconciliation tolerance in percentage points (UK HE convention). */
export const DEFAULT_TOLERANCE_THRESHOLD = 5;

/** Derived-status union — the canonical state names exposed in the response. */
export type SecondMarkingStatus =
  | 'ASSIGNED_TO_SECOND'
  | 'SECOND_MARKED'
  | 'RECONCILED';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the (assessmentId, studentId) pair for a given AssessmentAttempt id.
 * SecondMarkingRecord is keyed on (assessmentId, studentId), not directly on
 * attemptId, so every action must derive the pair from the parent attempt.
 */
async function resolveAttemptPair(attemptId: string): Promise<{
  attempt: NonNullable<Awaited<ReturnType<typeof attemptRepo.getById>>>;
  studentId: string;
}> {
  const attempt = await attemptRepo.getById(attemptId);
  if (!attempt) throw new NotFoundError('AssessmentAttempt', attemptId);
  const studentId = attempt.moduleRegistration?.enrolment?.studentId;
  if (!studentId) {
    throw new ValidationError(
      `AssessmentAttempt ${attemptId} cannot be resolved to a student — moduleRegistration.enrolment.studentId is missing.`,
    );
  }
  return { attempt, studentId };
}

/**
 * Derived-status helper. The persisted columns alone cannot fully
 * distinguish ASSIGNED_TO_SECOND from SECOND_MARKED (we use the audit /
 * event trail for the canonical milestone). This helper returns
 * RECONCILED whenever the row carries a completedDate, otherwise
 * SECOND_MARKED whenever the row's `updatedAt` is strictly after
 * `createdAt` (i.e. a recordSecondMark has fired), otherwise
 * ASSIGNED_TO_SECOND. This is heuristic but stable for the operator UI;
 * downstream consumers needing the canonical milestone read the audit
 * log or subscribe to the corresponding webhook events.
 */
export function deriveStatus(record: {
  completedDate: Date | null;
  agreedMark: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SecondMarkingStatus {
  if (record.completedDate != null && record.agreedMark != null) {
    return 'RECONCILED';
  }
  // updatedAt strictly after createdAt indicates a subsequent patch
  // (recordSecondMark would always emit one). Equality / earlier means
  // the row is still in the as-created (assigned) shape.
  if (record.updatedAt.getTime() > record.createdAt.getTime() + 1) {
    return 'SECOND_MARKED';
  }
  return 'ASSIGNED_TO_SECOND';
}

// ── Public API: list / getById ───────────────────────────────────────────────

export interface SecondMarkingListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  attemptId?: string;
  assessmentId?: string;
  studentId?: string;
  secondMarkerId?: string;
  reconciled?: boolean;
}

export async function list(query: SecondMarkingListQuery) {
  const { cursor, limit, sort, order, attemptId, assessmentId, studentId, secondMarkerId, reconciled } = query;

  // attemptId is a convenience filter — resolve it to (assessmentId, studentId)
  // before delegating to the repo layer, which cannot join across the
  // moduleRegistration → enrolment chain without an extra round-trip.
  if (attemptId) {
    const { attempt, studentId: derivedStudentId } = await resolveAttemptPair(attemptId);
    return repo.list(
      {
        assessmentId: attempt.assessmentId,
        studentId: derivedStudentId,
        ...(secondMarkerId ? { secondMarkerId } : {}),
        ...(reconciled !== undefined ? { reconciled } : {}),
      },
      { cursor, limit, sort, order },
    );
  }

  return repo.list(
    {
      ...(assessmentId ? { assessmentId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(secondMarkerId ? { secondMarkerId } : {}),
      ...(reconciled !== undefined ? { reconciled } : {}),
    },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('SecondMarkingRecord', id);
  return result;
}

// ── Public API: assignSecondMarker ───────────────────────────────────────────

export interface AssignSecondMarkerOptions {
  /** Marker user-id to assign as the second marker. */
  secondMarkerId: string;
  /**
   * When true, allows assignment even when one or more SecondMarkingRecord
   * rows already exist for this (assessmentId, studentId) pair. The
   * default behaviour is to refuse, mirroring the "one outstanding
   * second-marking assignment per attempt" convention.
   */
  force?: boolean;
}

/**
 * POST /v1/marks/:id/assign-second-marker handler.
 *
 * Assigns a second marker to an AssessmentAttempt by creating a fresh
 * SecondMarkingRecord. The schema requires `secondMarkerMark` to be
 * non-null at creation, so the service initialises it as a placeholder
 * equal to the parent attempt's `rawMark` (or `0` when no rawMark exists
 * yet — the assignment can run before the first marker has filled the
 * mark, in which case the placeholder is overwritten by `recordSecondMark`).
 *
 * Independence guard: rejects when `secondMarkerId === attempt.markedBy`,
 * mirroring the Phase 17B moderator-independence rule on the parent
 * AssessmentAttempt.
 *
 * Refuses if a SecondMarkingRecord already exists for this attempt's
 * (assessmentId, studentId) pair unless `force: true`.
 *
 * Audits subject = AssessmentAttempt (the assignment is conceptually a
 * mutation against the attempt) and emits `second_marking.assigned`.
 *
 * @throws NotFoundError when the AssessmentAttempt does not exist.
 * @throws ValidationError on independence failure or duplicate-without-force.
 */
export async function assignSecondMarker(
  attemptId: string,
  options: AssignSecondMarkerOptions,
  userId: string,
  req: Request,
) {
  const { attempt, studentId } = await resolveAttemptPair(attemptId);

  // Independence — the assigned second marker must differ from the
  // user who marked the parent attempt. Mirrors Phase 17B's
  // moderator-independence rule (marks.service::assertModeratorIsIndependent).
  if (attempt.markedBy && attempt.markedBy === options.secondMarkerId) {
    throw new ValidationError(
      `Second marker must be independent of the first marker: secondMarkerId (${options.secondMarkerId}) cannot equal markedBy.`,
    );
  }

  // Refuse a double-assignment for the same (assessmentId, studentId)
  // pair unless force:true. The repo helper returns ALL rows (including
  // historical reconciled ones); for assignment-blocking purposes only
  // *open* rows count — a previously-reconciled assignment is
  // historical and does not block a fresh re-assignment (e.g. on a
  // resubmission cycle).
  const existing = await repo.findByAttempt(attempt.assessmentId, studentId);
  const openExisting = existing.filter((r) => r.completedDate == null);
  if (openExisting.length > 0 && options.force !== true) {
    throw new ValidationError(
      `A SecondMarkingRecord (${openExisting[0].id}) already exists for AssessmentAttempt ${attemptId} and is not yet reconciled. ` +
        'Reconcile or remove it first, or re-run with force: true to override.',
    );
  }

  // Initialise secondMarkerMark as a placeholder equal to firstMarkerMark.
  // The schema requires both columns to be non-null at creation.
  // recordSecondMark overwrites the placeholder with the real value.
  const firstMarkerMark =
    attempt.rawMark != null ? toNumber(attempt.rawMark as unknown as DecimalLike) : 0;

  const created = await repo.create({
    assessmentId: attempt.assessmentId,
    studentId,
    firstMarkerMark,
    secondMarkerMark: firstMarkerMark, // placeholder; overwritten by recordSecondMark
    secondMarkerId: options.secondMarkerId,
    createdBy: userId,
    updatedBy: userId,
  });

  await logAudit(
    'AssessmentAttempt',
    attemptId,
    'UPDATE',
    userId,
    null,
    {
      action: 'second_marker_assigned',
      secondMarkingRecordId: created.id,
      secondMarkerId: options.secondMarkerId,
      firstMarkerMark,
      ...(options.force === true ? { force: true } : {}),
    } as unknown as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'second_marking.assigned',
    entityType: 'SecondMarkingRecord',
    entityId: created.id,
    actorId: userId,
    data: {
      assessmentAttemptId: attemptId,
      assessmentId: attempt.assessmentId,
      studentId,
      secondMarkerId: options.secondMarkerId,
      firstMarkerId: attempt.markedBy ?? null,
      firstMarkerMark,
      status: 'ASSIGNED_TO_SECOND' as SecondMarkingStatus,
      ...(options.force === true ? { force: true } : {}),
    },
  });

  return { ...created, derivedStatus: 'ASSIGNED_TO_SECOND' as SecondMarkingStatus };
}

// ── Public API: recordSecondMark ─────────────────────────────────────────────

export interface RecordSecondMarkOptions {
  /** The mark recorded by the assigned second marker. */
  secondMark: number;
  /** Optional second-marker feedback recorded against the parent attempt's `feedback`. */
  feedback?: string;
  /**
   * When true, bypasses the "caller must be the assigned secondMarkerId"
   * guard. Used by registry overrides where an admissions officer is
   * recording on behalf of the marker.
   */
  force?: boolean;
}

/**
 * POST /v1/second-marking/:id/record-second-mark handler.
 *
 * Records the second marker's mark against an existing SecondMarkingRecord.
 * Drives the ASSIGNED_TO_SECOND → SECOND_MARKED transition.
 *
 * Independence guard at recording time: the caller (`userId`) MUST equal
 * the assigned `secondMarkerId` on the row, OR `force: true` must be
 * supplied. This prevents back-channel mark substitution.
 *
 * Refuses when the row is already RECONCILED (completedDate non-null).
 *
 * Audits subject = SecondMarkingRecord and emits `second_marking.recorded`.
 *
 * @throws NotFoundError when the SecondMarkingRecord does not exist.
 * @throws ValidationError on independence failure / already-reconciled.
 */
export async function recordSecondMark(
  secondMarkingRecordId: string,
  options: RecordSecondMarkOptions,
  userId: string,
  req: Request,
) {
  const previous = await getById(secondMarkingRecordId);

  if (previous.completedDate != null) {
    throw new ValidationError(
      `SecondMarkingRecord ${secondMarkingRecordId} is already reconciled (completedDate=${previous.completedDate.toISOString()}). ` +
        'Reconciled records are append-only.',
    );
  }

  if (previous.secondMarkerId !== userId && options.force !== true) {
    throw new ValidationError(
      `Only the assigned second marker (${previous.secondMarkerId}) may record the second mark on SecondMarkingRecord ${secondMarkingRecordId}. ` +
        'Re-run with force: true for a registry-level override.',
    );
  }

  const result = await repo.update(secondMarkingRecordId, {
    secondMarkerMark: options.secondMark,
    updatedBy: userId,
  });

  await logAudit(
    'SecondMarkingRecord',
    secondMarkingRecordId,
    'UPDATE',
    userId,
    previous,
    result,
    req,
  );

  emitEvent({
    event: 'second_marking.recorded',
    entityType: 'SecondMarkingRecord',
    entityId: secondMarkingRecordId,
    actorId: userId,
    data: {
      assessmentId: result.assessmentId,
      studentId: result.studentId,
      secondMarkerId: result.secondMarkerId,
      firstMarkerMark: toNumber(result.firstMarkerMark as unknown as DecimalLike),
      secondMarkerMark: toNumber(result.secondMarkerMark as unknown as DecimalLike),
      status: 'SECOND_MARKED' as SecondMarkingStatus,
      ...(options.force === true ? { force: true } : {}),
    },
  });

  // Surface the recorded feedback into the parent attempt's `feedback`
  // column when supplied — keeps marker comments visible on the
  // assessment attempt record without requiring a second screen.
  if (options.feedback !== undefined) {
    try {
      // Find the parent attempt by (assessmentId, studentId).
      const attempts = await marksService.list({
        cursor: undefined,
        limit: 1,
        sort: 'createdAt',
        order: 'desc',
        assessmentId: result.assessmentId,
        studentId: result.studentId,
      });
      const attempt = attempts.data?.[0];
      if (attempt) {
        await marksService.update(
          attempt.id,
          { feedback: options.feedback } as Prisma.AssessmentAttemptUpdateInput,
          userId,
          req,
        );
      }
    } catch {
      // Best-effort propagation: a failure here does NOT roll back the
      // recording event — the SecondMarkingRecord itself is the
      // academic-governance source of truth.
    }
  }

  return { ...result, derivedStatus: 'SECOND_MARKED' as SecondMarkingStatus };
}

// ── Public API: reconcileMarks ───────────────────────────────────────────────

export interface ReconcileMarksOptions {
  /**
   * Optional explicit reconciled mark. When omitted, the service applies
   * the auto-reconciliation rule:
   *   if |firstMarkerMark − secondMarkerMark| <= toleranceThreshold,
   *     accept (firstMarkerMark + secondMarkerMark) / 2
   *   otherwise emit `second_marking.requires_third_marker` and refuse.
   */
  reconciledMark?: number;
  /**
   * Tolerance threshold in percentage points. Defaults to
   * `DEFAULT_TOLERANCE_THRESHOLD` (5pp — UK HE convention).
   */
  toleranceThreshold?: number;
  /** Optional notes captured in the audit + event payload (NOT persisted; the schema has no notes column). */
  reconciliationNotes?: string;
  /**
   * When true, bypasses the tolerance check and accepts the supplied
   * `reconciledMark` even when first and second marks are far apart.
   */
  force?: boolean;
  /**
   * When true, propagate the agreed mark onto the parent AssessmentAttempt's
   * `moderatedMark` via marks.service.update. Defaults to true. Failures
   * during propagation are non-fatal — the SecondMarkingRecord
   * reconciliation is the academic-governance source of truth and is
   * recorded regardless.
   */
  propagateToAttempt?: boolean;
}

export interface ReconcileMarksOutcome {
  secondMarkingRecordId: string;
  /** First marker's mark (echoed for the n8n integration payload). */
  firstMarkerMark: number;
  /** Second marker's mark. */
  secondMarkerMark: number;
  /** Difference in percentage points. */
  difference: number;
  /** Tolerance threshold applied (defaults to DEFAULT_TOLERANCE_THRESHOLD). */
  toleranceThreshold: number;
  /** True iff the difference is within tolerance. */
  withinTolerance: boolean;
  /** The reconciled mark when reconciliation succeeds; null when a third marker is required. */
  agreedMark: number | null;
  /** True iff a third marker is required (difference > tolerance and no explicit reconciledMark / force). */
  requiresThirdMarker: boolean;
  /** True iff the parent AssessmentAttempt's moderatedMark was updated. */
  propagatedToAttempt: boolean;
}

/**
 * POST /v1/second-marking/:id/reconcile handler.
 *
 * Drives the SECOND_MARKED → RECONCILED transition. Two operating modes:
 *
 *   auto-reconcile (default)
 *     If |firstMarkerMark − secondMarkerMark| <= toleranceThreshold
 *     (default 5 percentage points), the service accepts the average
 *     and stamps `agreedMark` and `completedDate`. Outside tolerance,
 *     the service refuses, emits `second_marking.requires_third_marker`,
 *     and returns an outcome with `requiresThirdMarker: true`.
 *
 *   explicit reconciliation
 *     The caller supplies `reconciledMark`. With `force: true` (or
 *     within tolerance) the service accepts the value verbatim. Without
 *     force, the value is also subjected to the tolerance check —
 *     callers wanting to commit a value outside tolerance must opt in
 *     via force.
 *
 * On success, the agreed mark is propagated to the parent
 * AssessmentAttempt's `moderatedMark` via marks.service.update so the
 * Phase 17B audit + event trail fires on its normal path. Set
 * `propagateToAttempt: false` to skip the propagation (e.g. preview).
 *
 * @throws NotFoundError when the SecondMarkingRecord does not exist.
 * @throws ValidationError when already reconciled.
 */
export async function reconcileMarks(
  secondMarkingRecordId: string,
  options: ReconcileMarksOptions,
  userId: string,
  req: Request,
): Promise<ReconcileMarksOutcome> {
  const previous = await getById(secondMarkingRecordId);

  if (previous.completedDate != null) {
    throw new ValidationError(
      `SecondMarkingRecord ${secondMarkingRecordId} is already reconciled (completedDate=${previous.completedDate.toISOString()}).`,
    );
  }

  const firstMarkerMark = toNumber(previous.firstMarkerMark as unknown as DecimalLike);
  const secondMarkerMark = toNumber(previous.secondMarkerMark as unknown as DecimalLike);
  const difference = Math.abs(firstMarkerMark - secondMarkerMark);
  const toleranceThreshold =
    options.toleranceThreshold !== undefined && options.toleranceThreshold >= 0
      ? options.toleranceThreshold
      : DEFAULT_TOLERANCE_THRESHOLD;
  const withinTolerance = difference <= toleranceThreshold;

  let agreedMark: number | null = null;
  let requiresThirdMarker = false;

  if (options.reconciledMark !== undefined) {
    // Explicit operator-supplied reconciliation — accept when within
    // tolerance OR when force:true. Outside tolerance without force is
    // rejected so registry overrides remain explicit.
    if (!withinTolerance && options.force !== true) {
      requiresThirdMarker = true;
    } else {
      agreedMark = options.reconciledMark;
    }
  } else if (withinTolerance) {
    // Auto-reconcile to the average. Round to 2dp to mirror the
    // Decimal(6,2) precision on the agreedMark column.
    agreedMark = Math.round(((firstMarkerMark + secondMarkerMark) / 2) * 100) / 100;
  } else {
    requiresThirdMarker = true;
  }

  if (requiresThirdMarker) {
    // Do NOT mutate the SecondMarkingRecord; the row stays in
    // SECOND_MARKED state pending third-marker assignment. The event
    // gives n8n a single subscription point to fan out an
    // assignment-creation workflow once the third-marker pipeline
    // exists (Workstream C follow-on).
    emitEvent({
      event: 'second_marking.requires_third_marker',
      entityType: 'SecondMarkingRecord',
      entityId: secondMarkingRecordId,
      actorId: userId,
      data: {
        assessmentId: previous.assessmentId,
        studentId: previous.studentId,
        firstMarkerMark,
        secondMarkerMark,
        difference,
        toleranceThreshold,
        ...(options.reconciledMark !== undefined ? { proposedReconciledMark: options.reconciledMark } : {}),
        ...(options.reconciliationNotes !== undefined ? { reconciliationNotes: options.reconciliationNotes } : {}),
      },
    });
    return {
      secondMarkingRecordId,
      firstMarkerMark,
      secondMarkerMark,
      difference,
      toleranceThreshold,
      withinTolerance,
      agreedMark: null,
      requiresThirdMarker: true,
      propagatedToAttempt: false,
    };
  }

  // Reconciliation accepted — stamp the row.
  const completedDate = new Date();
  const result = await repo.update(secondMarkingRecordId, {
    agreedMark,
    completedDate,
    updatedBy: userId,
  });

  await logAudit(
    'SecondMarkingRecord',
    secondMarkingRecordId,
    'UPDATE',
    userId,
    previous,
    {
      ...result,
      _reconciliationNotes: options.reconciliationNotes ?? null,
      _force: options.force === true,
    } as unknown as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'second_marking.reconciled',
    entityType: 'SecondMarkingRecord',
    entityId: secondMarkingRecordId,
    actorId: userId,
    data: {
      assessmentId: previous.assessmentId,
      studentId: previous.studentId,
      firstMarkerMark,
      secondMarkerMark,
      difference,
      toleranceThreshold,
      withinTolerance,
      agreedMark,
      completedDate: completedDate.toISOString(),
      autoReconciled: options.reconciledMark === undefined,
      ...(options.reconciliationNotes !== undefined ? { reconciliationNotes: options.reconciliationNotes } : {}),
      ...(options.force === true ? { force: true } : {}),
    },
  });

  // Propagate the agreed mark onto the parent AssessmentAttempt's
  // moderatedMark so the Phase 17B audit / `marks.status_changed`
  // events fire on their normal path. Best-effort: a propagation failure
  // does NOT roll back this reconciliation (see header comment).
  let propagatedToAttempt = false;
  if (options.propagateToAttempt !== false && agreedMark != null) {
    try {
      const attempts = await marksService.list({
        cursor: undefined,
        limit: 1,
        sort: 'createdAt',
        order: 'desc',
        assessmentId: previous.assessmentId,
        studentId: previous.studentId,
      });
      const attempt = attempts.data?.[0];
      if (attempt) {
        await marksService.update(
          attempt.id,
          { moderatedMark: agreedMark } as Prisma.AssessmentAttemptUpdateInput,
          userId,
          req,
        );
        propagatedToAttempt = true;
      }
    } catch {
      // Swallow — see header comment for the propagation rationale.
    }
  }

  return {
    secondMarkingRecordId,
    firstMarkerMark,
    secondMarkerMark,
    difference,
    toleranceThreshold,
    withinTolerance,
    agreedMark,
    requiresThirdMarker: false,
    propagatedToAttempt,
  };
}
