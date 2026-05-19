import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const STATUS = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);

/** Academic year shape: e.g. "2025/26". */
const ACADEMIC_YEAR = z.string().regex(/^\d{4}\/\d{2}$/, {
  message: 'academicYear must match YYYY/YY (e.g. 2025/26)',
});

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('issueDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  sponsorId: z.string().optional(),
  sponsorAgreementId: z.string().optional(),
  status: STATUS.optional(),
  academicYear: z.string().optional(),
  invoiceNumber: z.string().optional(),
});

export const createSchema = z.object({
  sponsorId: z.string().min(1),
  sponsorAgreementId: z.string().min(1).optional(),
  invoiceNumber: z.string().min(1).max(50),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  academicYear: ACADEMIC_YEAR,
  amount: z.number().positive(),
  paidAmount: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  status: STATUS.optional(),
  notes: z.string().max(2000).optional(),
});

export const updateSchema = z.object({
  sponsorAgreementId: z.string().min(1).nullable().optional(),
  invoiceNumber: z.string().min(1).max(50).optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  academicYear: ACADEMIC_YEAR.optional(),
  amount: z.number().positive().optional(),
  paidAmount: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  status: STATUS.optional(),
  sentDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
