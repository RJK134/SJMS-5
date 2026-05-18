import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('issuedDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  invoiceId: z.string().optional(),
});

export const createSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(1),
  issuedDate: z.coerce.date(),
});

export const updateSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().min(1).optional(),
  issuedDate: z.coerce.date().optional(),
});
