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
