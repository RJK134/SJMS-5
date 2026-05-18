import { z } from 'zod';
// Cohort generator shares attempt-status literals with the marks aggregate endpoint (Phase 17C).
import { ATTEMPT_STATUSES } from '../marks/marks.schema';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  moduleId: z.string().optional(), academicYear: z.string().optional(), status: z.string().optional(),
});

export const createSchema = z.object({
  moduleRegistrationId: z.string().min(1), moduleId: z.string().min(1),
    academicYear: z.string().regex(/^\d{4}\/\d{2}$/),
    aggregateMark: z.number().min(0).optional(), grade: z.string().optional(),
    status: z.enum(['PROVISIONAL','CONFIRMED','REFERRED','DEFERRED']).default('PROVISIONAL'),
});

export const updateSchema = createSchema.partial();

// ── Phase 17B — POST /v1/module-results/:id/ratify ────────────────────────
//
// Action-named ratification endpoint. boardId is optional. The service
// stamps confirmedDate and confirmedBy from the authenticated user context
// when not supplied (see `module-results.service.update`). The HTTP body
// only accepts boardId — confirmedBy is NOT accessible via any HTTP route
// (neither this endpoint nor the generic PATCH, since updateSchema is
// createSchema.partial() and createSchema does not include confirmedBy).
// It is available only when calling the service directly from another
// service or test. The state-machine and cross-entity guards in
// `module-results.service.update` enforce the substantive rules (every
// AssessmentAttempt under the moduleRegistration must already be CONFIRMED).
export const ratifySchema = z.object({
  boardId: z.string().min(1).optional(),
});

// ── Phase 17C — POST /v1/module-results/generate ─────────────────────────
//
// Cohort-level batch generation. Drives `marks.service.generateModuleResultsForCohort`.
// Defaults match the underlying primitive: preview-only, CONFIRMED-only attempts.
// `persist: true` runs through `aggregateForModuleRegistration` per row and
// upserts a ModuleResult; `force: true` permits incomplete / non-100% rows
// on the persist path (the resulting rows stay PROVISIONAL — only
// `/ratify` flips them to CONFIRMED). The service captures per-row failures
// rather than aborting the cohort, so the response always carries a
// summary even when individual rows error.
export const generateSchema = z.object({
  moduleId: z.string().min(1),
  academicYear: z.string().regex(/^\d{4}\/\d{2}$/),
  /** Restrict which AssessmentAttempt statuses contribute. Defaults to ['CONFIRMED']. */
  attemptStatuses: z.array(z.enum(ATTEMPT_STATUSES)).min(1).optional(),
  /** Optional assessment whose GradeBoundary set is used to resolve a grade per row. */
  boundaryAssessmentId: z.string().min(1).optional(),
  /** Persist each row's aggregate to ModuleResult. Defaults to false (cohort-wide preview). */
  persist: z.boolean().optional(),
  /** Force-override incomplete / non-100% rows on the persist path. */
  force: z.boolean().optional(),
});
