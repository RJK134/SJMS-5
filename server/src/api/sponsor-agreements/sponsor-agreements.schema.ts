import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const SPONSOR_TYPE = z.enum(['SLC', 'EMPLOYER', 'GOVERNMENT', 'CHARITY', 'EMBASSY', 'OTHER']);

/** Academic year shape: e.g. "2025/26". */
const ACADEMIC_YEAR = z.string().regex(/^\d{4}\/\d{2}$/, {
  message: 'academicYear must match YYYY/YY (e.g. 2025/26)',
});

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  studentAccountId: z.string().optional(),
  sponsorType: SPONSOR_TYPE.optional(),
  status: z.string().optional(),
  academicYear: z.string().optional(),
});

export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  sponsorName: z.string().min(1),
  sponsorType: SPONSOR_TYPE,
  agreementRef: z.string().optional(),
  academicYear: ACADEMIC_YEAR,
  amountAgreed: z.number().nonnegative(),
  amountReceived: z.number().nonnegative().optional(),
  status: z.string().optional(),
});

export const updateSchema = z.object({
  sponsorName: z.string().min(1).optional(),
  sponsorType: SPONSOR_TYPE.optional(),
  agreementRef: z.string().nullable().optional(),
  academicYear: ACADEMIC_YEAR.optional(),
  amountAgreed: z.number().nonnegative().optional(),
  amountReceived: z.number().nonnegative().optional(),
  status: z.string().optional(),
});
