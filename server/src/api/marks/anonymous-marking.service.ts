import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import * as repo from '../../repositories/anonymousMarking.repository';
import * as attemptRepo from '../../repositories/assessmentAttempt.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Workstream C3 — Anonymous-marking workflow service ──────────────────────
//
// Records the anonymisation lifecycle for an AssessmentAttempt. Each
// AnonymousMarking row binds an (assessmentId, studentId) pair to a
// generated `anonymousId` so marker-facing views can render the
// candidate as e.g. `ANON-A4F1` rather than disclosing the student's real
// identity. Reveal flips `revealed` to true, stamps `revealedDate`, and is
// one-way: an anonymisation cannot be un-revealed once disclosure has
// been recorded, preserving the integrity of the audit trail.
//
// Schema constraints honoured (from prisma/schema.prisma:2588):
//   - `anonymousId` is `@unique` — the service generates a collision-safe
//     short identifier with a small retry loop on the (very rare)
//     uniqueness violation.
//   - There is NO `revealedBy` column. The reveal action records the
//     revealing user via `updatedBy` AND through the AuditLog +
//     emitted-event payload. The Workstream C3 brief is explicit on the
//     no-migration rule and tolerates the missing column.
//   - There is NO `justification` column. The justification supplied to
//     `reveal()` is captured in the audit row and emitted webhook payload.
//   - There is no `deletedAt` column — once an anonymisation row exists,
//     it is append-only (the row is never deleted by the service).

/** Length of the random suffix used in `anonymousId`. */
const ANONYMOUS_ID_SUFFIX_BYTES = 3; // → 6 uppercased hex chars
const ANONYMOUS_ID_PREFIX = 'ANON';
const ANONYMOUS_ID_MAX_RETRIES = 5;

/**
 * Generate a candidate anonymousId of the form `ANON-XXXXXX` (6 hex
 * chars from the cryptographic PRNG, uppercased). Repeated calls
 * are vanishingly unlikely to collide; `anonymise` retries up to
 * ANONYMOUS_ID_MAX_RETRIES times against the schema's @unique
 * constraint to be safe.
 */
function generateAnonymousId(): string {
  return `${ANONYMOUS_ID_PREFIX}-${randomBytes(ANONYMOUS_ID_SUFFIX_BYTES)
    .toString('hex')
    .toUpperCase()}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Public API: list / getById ──────────────────────────────────────────────

export interface AnonymousMarkingListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  assessmentId?: string;
  studentId?: string;
  revealed?: boolean;
}

export async function list(query: AnonymousMarkingListQuery) {
  const { cursor, limit, sort, order, assessmentId, studentId, revealed } = query;
  return repo.list(
    {
      ...(assessmentId ? { assessmentId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(revealed !== undefined ? { revealed } : {}),
    },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('AnonymousMarking', id);
  return result;
}

// ── Public API: anonymise ───────────────────────────────────────────────────

export interface AnonymiseOptions {
  /**
   * When true, allows anonymisation even when an AnonymousMarking row
   * already exists for this attempt's (assessmentId, studentId) pair.
   * Default false — the service refuses a duplicate so the
   * marker-facing identifier stays stable across the lifecycle of a
   * single submission.
   */
  force?: boolean;
}

export interface AnonymiseOutcome {
  anonymousMarkingId: string;
  anonymousId: string;
  assessmentId: string;
  studentId: string;
}

/**
 * POST /v1/marks/:id/anonymise handler.
 *
 * Anonymises an AssessmentAttempt by creating a fresh AnonymousMarking
 * row for the (assessmentId, studentId) pair derived from the parent
 * attempt. The resulting `anonymousId` is the marker-facing label.
 *
 * Refuses if an AnonymousMarking row already exists for this
 * (assessmentId, studentId) pair unless `force: true`. A "force re-
 * anonymise" allocates a fresh anonymousId; the previous row remains
 * (append-only).
 *
 * Audits subject = AnonymousMarking and emits `anonymous_marking.created`.
 *
 * @throws NotFoundError when the AssessmentAttempt does not exist.
 * @throws ValidationError on duplicate-without-force.
 */
export async function anonymise(
  attemptId: string,
  options: AnonymiseOptions,
  userId: string,
  req: Request,
): Promise<AnonymiseOutcome> {
  const { attempt, studentId } = await resolveAttemptPair(attemptId);

  const existing = await repo.findByAttempt(attempt.assessmentId, studentId);
  if (existing.length > 0 && options.force !== true) {
    throw new ValidationError(
      `AnonymousMarking already exists for AssessmentAttempt ${attemptId} (anonymousId=${existing[0].anonymousId}). ` +
        'Re-run with force: true to allocate a fresh anonymousId (the existing row remains for audit).',
    );
  }

  // Generate-and-retry against the @unique constraint on anonymousId.
  // The 24-bit suffix gives a 1-in-16M collision probability per attempt;
  // the retry loop is a defensive belt rather than a hot path.
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex < ANONYMOUS_ID_MAX_RETRIES; attemptIndex += 1) {
    const anonymousId = generateAnonymousId();
    try {
      const created = await repo.create({
        assessmentId: attempt.assessmentId,
        studentId,
        anonymousId,
        revealed: false,
        createdBy: userId,
        updatedBy: userId,
      });

      await logAudit(
        'AnonymousMarking',
        created.id,
        'CREATE',
        userId,
        null,
        created,
        req,
      );

      emitEvent({
        event: 'anonymous_marking.created',
        entityType: 'AnonymousMarking',
        entityId: created.id,
        actorId: userId,
        data: {
          assessmentAttemptId: attemptId,
          assessmentId: attempt.assessmentId,
          studentId,
          anonymousId,
          ...(options.force === true ? { force: true } : {}),
        },
      });

      return {
        anonymousMarkingId: created.id,
        anonymousId,
        assessmentId: attempt.assessmentId,
        studentId,
      };
    } catch (err) {
      // Detect Prisma unique-constraint violation (P2002) and retry.
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  // Five collisions running is statistically impossible in practice, so
  // this is almost certainly a misconfigured DB. Rethrow with context.
  throw new ValidationError(
    `Failed to allocate a unique anonymousId after ${ANONYMOUS_ID_MAX_RETRIES} attempts: ${(lastError as Error)?.message ?? 'unknown error'}`,
  );
}

// ── Public API: reveal ──────────────────────────────────────────────────────

export interface RevealOptions {
  /** Audit reason for the reveal. Required — must be a non-empty string. */
  justification: string;
}

export interface RevealOutcome {
  anonymousMarkingId: string;
  anonymousId: string;
  studentId: string;
  revealedDate: Date;
  revealedBy: string;
}

/**
 * POST /v1/anonymous-marking/:id/reveal handler.
 *
 * Flips an AnonymousMarking row to `revealed: true` and stamps the
 * `revealedDate` column. Append-only — the row is not deleted, and
 * an already-revealed row cannot be revealed again (the call is
 * rejected with ValidationError so the caller knows the disclosure
 * milestone has already been recorded).
 *
 * Requires a non-empty `justification`. The schema has no
 * `justification` column; the value is captured in the AuditLog row's
 * `newData` blob and the emitted webhook payload, which is the same
 * channel the AuditLog uses for every other "reason for action"
 * (e.g. force-overrides on Phase 17B moderation).
 *
 * Similarly, the schema has no `revealedBy` column. The revealing
 * user is captured via `updatedBy` (a column the schema does carry)
 * AND through the audit + event payload.
 *
 * Audits subject = AnonymousMarking and emits `anonymous_marking.revealed`.
 *
 * @throws NotFoundError when the AnonymousMarking does not exist.
 * @throws ValidationError when the row is already revealed, or when
 *         the justification is missing / empty.
 */
export async function reveal(
  anonymousMarkingId: string,
  options: RevealOptions,
  userId: string,
  req: Request,
): Promise<RevealOutcome> {
  const previous = await getById(anonymousMarkingId);

  if (previous.revealed) {
    throw new ValidationError(
      `AnonymousMarking ${anonymousMarkingId} is already revealed (revealedDate=${
        previous.revealedDate?.toISOString() ?? 'unknown'
      }). Reveals are append-only.`,
    );
  }

  const justification = options.justification?.trim();
  if (!justification) {
    throw new ValidationError(
      'Justification is required to reveal an anonymous marker. Supply a non-empty `justification` string explaining the operational reason for disclosure.',
    );
  }

  const result = await repo.revealMarker(anonymousMarkingId, userId);

  await logAudit(
    'AnonymousMarking',
    anonymousMarkingId,
    'UPDATE',
    userId,
    previous,
    {
      ...result,
      _justification: justification,
      _revealedBy: userId,
    } as unknown as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'anonymous_marking.revealed',
    entityType: 'AnonymousMarking',
    entityId: anonymousMarkingId,
    actorId: userId,
    data: {
      assessmentId: result.assessmentId,
      studentId: result.studentId,
      anonymousId: result.anonymousId,
      revealedBy: userId,
      revealedDate: result.revealedDate?.toISOString() ?? null,
      justification,
    },
  });

  return {
    anonymousMarkingId,
    anonymousId: result.anonymousId,
    studentId: result.studentId,
    revealedDate: result.revealedDate ?? new Date(),
    revealedBy: userId,
  };
}
