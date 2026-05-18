import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const REFUND_STATUS = z.enum(['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED']);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  studentAccountId: z.string().optional(),
  status: REFUND_STATUS.optional(),
});

export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(1),
});

export const updateSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().min(1).optional(),
  approvedBy: z.string().nullable().optional(),
  approvedDate: z.coerce.date().nullable().optional(),
  processedDate: z.coerce.date().nullable().optional(),
  status: REFUND_STATUS.optional(),
});
