import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const FUND_TYPE = z.enum(['BURSARY', 'SCHOLARSHIP', 'HARDSHIP', 'PRIZE', 'ACCESS']);

const ACADEMIC_YEAR = z.string().regex(/^\d{4}\/\d{2}$/, {
  message: 'academicYear must match YYYY/YY (e.g. 2025/26)',
});

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  fundType: FUND_TYPE.optional(),
  academicYear: z.string().optional(),
});

export const createSchema = z
  .object({
    fundName: z.string().min(1),
    fundType: FUND_TYPE,
    academicYear: ACADEMIC_YEAR,
    totalBudget: z.number().nonnegative(),
    allocated: z.number().nonnegative().optional(),
    remaining: z.number().nonnegative(),
    /** Free-form JSON describing the eligibility rules (income thresholds, year groups, etc.). */
    eligibility: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((data, ctx) => {
    const allocated = data.allocated ?? 0;

    if (allocated > data.totalBudget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocated'],
        message: 'allocated cannot be greater than totalBudget',
      });
    }

    const expectedRemaining = data.totalBudget - allocated;
    if (data.remaining !== expectedRemaining) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remaining'],
        message: `remaining must equal totalBudget - allocated (${expectedRemaining})`,
      });
    }
  });

export const updateSchema = z.object({
  fundName: z.string().min(1).optional(),
  fundType: FUND_TYPE.optional(),
  academicYear: ACADEMIC_YEAR.optional(),
  totalBudget: z.number().nonnegative().optional(),
  allocated: z.number().nonnegative().optional(),
  remaining: z.number().nonnegative().optional(),
  eligibility: z.record(z.string(), z.unknown()).nullable().optional(),
});
