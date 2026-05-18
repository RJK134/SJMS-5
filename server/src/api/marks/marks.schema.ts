import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  studentId: z.string().optional(), // injected by scopeToUser middleware — do NOT remove
  assessmentId: z.string().optional(), moduleRegistrationId: z.string().optional(), status: z.string().optional(),
});

export const createSchema = z.object({
  assessmentId: z.string().min(1), moduleRegistrationId: z.string().min(1),
    attemptNumber: z.number().int().min(1).default(1),
    rawMark: z.number().min(0).optional(), finalMark: z.number().min(0).optional(),
    grade: z.string().optional(), status: z.enum(['PENDING','SUBMITTED','MARKED','MODERATED','CONFIRMED','REFERRED','DEFERRED']).default('PENDING'),
    feedback: z.string().optional(),
});

export const updateSchema = createSchema.partial();

// ── Phase 17A — POST /v1/marks/aggregate ──────────────────────────────────────
//
// Drives `marks.service.aggregateForModuleRegistration`. Defaults match the
// service-layer defaults: preview-only, CONFIRMED-only attempts. Callers
// running a pre-board preview can widen `attemptStatuses` and operators
// running a definitive aggregation set `persist: true` (which routes the
// upsert through `module-results.service` and is rejected on incomplete /
// non-100% inputs unless `force: true`).
export const ATTEMPT_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'MARKED',
  'MODERATED',
  'CONFIRMED',
  'REFERRED',
  'DEFERRED',
] as const;

export const aggregateSchema = z.object({
  moduleRegistrationId: z.string().min(1),
  /** Restrict which AssessmentAttempt statuses contribute. Defaults to ['CONFIRMED']. */
  attemptStatuses: z.array(z.enum(ATTEMPT_STATUSES)).min(1).optional(),
  /** Optional assessment whose GradeBoundary set is used to resolve a grade against the aggregate. */
  boundaryAssessmentId: z.string().min(1).optional(),
  /** Persist the aggregate to ModuleResult. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override for incomplete / non-100% aggregations. No effect unless persist: true. */
  force: z.boolean().optional(),
});

// ── Phase 17B — moderation / ratification action schemas ─────────────────────
//
// Drive the action-named endpoints `POST /v1/marks/:id/moderate` and
// `POST /v1/marks/:id/ratify`. The service-layer guards layer additional
// rules on top (independence, finalMark resolution, transition validity)
// so the schemas only enforce shape and basic numeric bounds.

/** POST /v1/marks/:id/moderate body schema. */
export const moderateSchema = z.object({
  /** Mark recorded by the moderator. Required to drive MARKED → MODERATED. */
  moderatedMark: z.number().min(0),
  /** Optional moderator-supplied feedback to overwrite the existing feedback. */
  feedback: z.string().optional(),
  /** Optional moderator identity override; omit to default to the authenticated user. */
  moderatedBy: z.string().min(1).optional(),
});

/** POST /v1/marks/:id/ratify body schema. */
export const ratifySchema = z.object({
  /** Optional explicit final mark. Omit to derive from moderatedMark / rawMark. */
  finalMark: z.number().min(0).optional(),
  /** Optional explicit grade. Omit to auto-resolve from the assessment's GradeBoundary set. */
  grade: z.string().min(1).optional(),
});

// ── Workstream C3 — second-marking and anonymous-marking action schemas ─────
//
// Two endpoints keyed on the parent AssessmentAttempt id live on the
// marks router for naming consistency with the rest of the moderation
// surface. Endpoints keyed on a SecondMarkingRecord / AnonymousMarking id
// live on the dedicated `/v1/second-marking` and `/v1/anonymous-marking`
// routers.

/** POST /v1/marks/:id/assign-second-marker body schema. */
export const assignSecondMarkerSchema = z.object({
  /** Marker user-id to assign as the second marker. Must differ from the parent attempt's markedBy (independence guard runs in the service layer). */
  secondMarkerId: z.string().min(1),
  /**
   * When true, allows assignment even when an open SecondMarkingRecord
   * already exists for the same (assessmentId, studentId) pair.
   */
  force: z.boolean().optional(),
});

/** POST /v1/marks/:id/anonymise body schema. */
export const anonymiseSchema = z.object({
  /**
   * When true, allows allocation of a fresh anonymousId even when an
   * existing AnonymousMarking row covers the same (assessmentId,
   * studentId) pair. The previous row is retained (append-only).
   */
  force: z.boolean().optional(),
});
