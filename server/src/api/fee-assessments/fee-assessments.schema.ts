import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('assessedDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  enrolmentId: z.string().optional(),
  feeStatus: z.string().optional(),
});

const FEE_STATUS = z.enum(['HOME', 'OVERSEAS', 'EU_TRANSITIONAL', 'ISLANDS', 'CHANNEL_ISLANDS']);

export const createSchema = z.object({
  enrolmentId: z.string().min(1),
  feeStatus: FEE_STATUS,
  assessedDate: z.coerce.date(),
  totalFee: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().optional(),
  finalFee: z.number().nonnegative(),
});

export const updateSchema = createSchema.partial();

// ── Phase 18A — POST /v1/fee-assessments/assess ─────────────────────────────
//
// Drives `feeAssessments.service.assessForEnrolment`. Defaults match the
// service-layer defaults: preview-only, default UK HE tariffs. Operators
// running the persist path get an upserted FeeAssessment through the
// existing service create/update path so audit + fee_assessment.created /
// fee_assessment.updated events fire on their normal paths.
const PROGRAMME_LEVEL = z.enum([
  'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8',
]);
const MODE_OF_STUDY = z.enum([
  'FULL_TIME', 'PART_TIME', 'SANDWICH', 'DISTANCE', 'BLOCK_RELEASE',
]);

export const assessSchema = z.object({
  enrolmentId: z.string().min(1),
  /** Override the credits assumed for the assessment (defaults to programme.creditTotal). */
  creditsTaken: z.number().positive().optional(),
  /** Optional rule overrides forwarded to the pure utility. */
  rules: z.object({
    perCreditRates: z.record(
      z.enum(['HOME', 'OVERSEAS', 'EU_TRANSITIONAL', 'ISLANDS', 'CHANNEL_ISLANDS']),
      z.record(PROGRAMME_LEVEL, z.number().nonnegative()),
    ).optional(),
    modeMultipliers: z.record(MODE_OF_STUDY, z.number().nonnegative()).optional(),
    maxDiscountRatio: z.number().min(0).max(1).optional(),
  }).optional(),
  /** Persist a FeeAssessment row. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override: persist even when the input has zero credits or no fee data. */
  force: z.boolean().optional(),
});
