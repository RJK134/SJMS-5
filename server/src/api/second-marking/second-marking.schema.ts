import { z } from 'zod';

// ── Workstream C3 — second-marking endpoint schemas ─────────────────────────
//
// Drives the `/v1/second-marking` router. The marks-level `assign-second-
// marker` schema lives in marks.schema.ts because it parameter-binds an
// AssessmentAttempt id; everything keyed on a SecondMarkingRecord id lives
// here.

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  /** Filter by parent AssessmentAttempt — service resolves to (assessmentId, studentId). */
  attemptId: z.string().optional(),
  assessmentId: z.string().optional(),
  studentId: z.string().optional(),
  /** Filter by the assigned second marker. */
  secondMarkerId: z.string().optional(),
  /** Brief uses `markerId` as the canonical query name. */
  markerId: z.string().optional(),
  /** Derived-status filter. RECONCILED maps to completedDate IS NOT NULL. */
  status: z.enum(['ASSIGNED_TO_SECOND', 'SECOND_MARKED', 'RECONCILED']).optional(),
  /** Direct toggle for the persisted column the repo can filter on. */
  reconciled: z.coerce.boolean().optional(),
});

/**
 * POST /v1/second-marking/:id/record-second-mark body schema.
 *
 * The independence guard at recording time runs in the service layer;
 * the schema only enforces shape and bounds.
 */
export const recordSecondMarkSchema = z.object({
  /** The mark recorded by the assigned second marker. Must be non-negative. */
  secondMark: z.number().min(0),
  /** Optional second-marker feedback propagated to the parent attempt's `feedback` column. */
  feedback: z.string().optional(),
  /**
   * When true, bypasses the "caller must be the assigned secondMarkerId"
   * guard. Used by registry overrides where an admissions officer is
   * recording on behalf of the marker.
   */
  force: z.boolean().optional(),
});

/**
 * POST /v1/second-marking/:id/reconcile body schema.
 *
 * Auto-reconcile is the default — the service applies the tolerance
 * rule (default 5 percentage points). An explicit `reconciledMark`
 * triggers operator-driven reconciliation (still subject to the
 * tolerance check unless `force: true`).
 */
export const reconcileSchema = z.object({
  /** Optional explicit reconciled mark. Must be non-negative. */
  reconciledMark: z.number().min(0).optional(),
  /** Tolerance in percentage points. Defaults to 5pp at the service layer. */
  toleranceThreshold: z.number().min(0).max(100).optional(),
  /** Notes captured on the audit + event payload. NOT persisted (the schema has no notes column). */
  reconciliationNotes: z.string().optional(),
  /** When true, bypasses the tolerance check (registry override). */
  force: z.boolean().optional(),
  /** When false, suppresses propagation of agreedMark onto the parent AssessmentAttempt's moderatedMark. Defaults to true. */
  propagateToAttempt: z.boolean().optional(),
});
