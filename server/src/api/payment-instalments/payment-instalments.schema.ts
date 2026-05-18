import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const PAYMENT_STATUS = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'REFUNDED']);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('dueDate'),
  order: z.enum(['asc', 'desc']).default('asc'),
  paymentPlanId: z.string().optional(),
  status: PAYMENT_STATUS.optional(),
});

export const updateSchema = z.object({
  amount: z.number().positive().optional(),
  dueDate: z.coerce.date().optional(),
  paidDate: z.coerce.date().nullable().optional(),
  status: PAYMENT_STATUS.optional(),
});

// ── Phase 18D — POST /v1/payment-instalments/:id/record-payment ──────────────
//
// Drives `payment-instalments.service.recordPayment` — the bridge
// that ties an instalment payment back into the 18C allocation
// pipeline. Defaults: FIFO strategy on the underlying allocator,
// reject mismatches on payment / instalment / plan unless force.
export const recordPaymentSchema = z.object({
  paymentId: z.string().min(1),
  strategy: z.enum(['FIFO', 'PROPORTIONAL']).optional(),
  force: z.boolean().optional(),
});
