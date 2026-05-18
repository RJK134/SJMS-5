import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  enrolmentId: z.string().optional(), academicYear: z.string().optional(),
});

export const createSchema = z.object({
  enrolmentId: z.string().min(1),
    academicYear: z.string().regex(/^\d{4}\/\d{2}$/),
    yearOfStudy: z.number().int().min(1),
    totalCreditsAttempted: z.number().int(), totalCreditsPassed: z.number().int(),
    averageMark: z.number().optional(),
    progressionDecision: z.enum(['PROGRESS','REPEAT_YEAR','REPEAT_MODULES','WITHDRAW','TRANSFER','AWARD']),
});

export const updateSchema = createSchema.partial();

// ── Phase 17D — POST /v1/progressions/decide ─────────────────────────────
//
// Drives `progressions.service.decideForEnrolmentYear`. Defaults match the
// service-layer defaults: preview-only, default UK HE pass marks. Operators
// running the persist path get an upserted ProgressionRecord through the
// existing service create/update path so audit + status_changed events fire
// on their normal paths.
export const decideSchema = z.object({
  enrolmentId: z.string().min(1),
  academicYear: z.string().regex(/^\d{4}\/\d{2}$/),
  /** Override the per-level pass mark (40 for L3-L6, 50 for L7-L8 by default). */
  passMark: z.number().min(0).max(100).optional(),
  /** Optional rule overrides. Forwarded as-is to the pure utility. */
  rules: z.object({
    fullYearCredits: z.number().int().min(0).optional(),
    maxCompensatedCredits: z.number().int().min(0).optional(),
    compensationMinMark: z.number().min(0).max(100).optional(),
    withdrawThresholdRatio: z.number().min(0).max(1).optional(),
  }).optional(),
  /** Persist a ProgressionRecord row. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override for empty-year inputs on the persist path. */
  force: z.boolean().optional(),
});
