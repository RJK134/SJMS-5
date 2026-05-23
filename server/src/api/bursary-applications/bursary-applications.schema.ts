import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const APP_STATUS = z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID']);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('applicationDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  bursaryFundId: z.string().optional(),
  studentId: z.string().optional(),
  status: APP_STATUS.optional(),
});

export const createSchema = z
  .object({
    bursaryFundId: z.string().min(1),
    studentId: z.string().min(1),
    applicationDate: z.coerce.date(),
    circumstancesDesc: z.string().optional(),
    householdIncome: z.number().nonnegative().optional(),
    status: APP_STATUS.optional(),
    awardAmount: z.number().nonnegative().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.status === 'APPROVED' || data.status === 'PAID') && data.awardAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awardAmount'],
        message: 'awardAmount is required when status is APPROVED or PAID',
      });
    }
  });

export const updateSchema = z
  .object({
    applicationDate: z.coerce.date().optional(),
    circumstancesDesc: z.string().nullable().optional(),
    householdIncome: z.number().nonnegative().nullable().optional(),
    status: APP_STATUS.optional(),
    awardAmount: z.number().nonnegative().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.status === 'APPROVED' || data.status === 'PAID') && data.awardAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awardAmount'],
        message: 'awardAmount is required when status is APPROVED or PAID',
      });
    }
  });

// ── Phase 1C — POST /v1/bursary-applications/:id/auto-decide ──────────────
//
// Drives `bursary-applications.service.autoDecideForApplication`.
// Defaults match the service-layer defaults: persist=true (commit the
// decision), force=false (refuse to overwrite a terminal status).
export const autoDecideSchema = z.object({
  persist: z.boolean().optional(),
  force: z.boolean().optional(),
  rules: z
    .object({
      autoRejectAboveIncome: z.number().nonnegative().optional(),
      autoApproveBelowIncome: z.number().nonnegative().optional(),
      defaultAwardAmount: z.number().nonnegative().optional(),
      maxAwardPerStudent: z.number().nonnegative().optional(),
      requiresCircumstancesDesc: z.boolean().optional(),
      feeStatusAllowList: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});
