import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const PAYMENT_PLAN_STATUS = z.enum(['ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED']);
const FREQUENCY = z.enum(['MONTHLY', 'QUARTERLY', 'CUSTOM']);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('startDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  studentAccountId: z.string().optional(),
  status: PAYMENT_PLAN_STATUS.optional(),
  planType: z.string().optional(),
});

export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  planType: z.string().min(1),
  totalAmount: z.number().positive(),
  numberOfInstalments: z.number().int().positive(),
  instalmentAmount: z.number().positive(),
  startDate: z.coerce.date(),
  status: PAYMENT_PLAN_STATUS.optional(),
});

export const updateSchema = z.object({
  planType: z.string().min(1).optional(),
  totalAmount: z.number().positive().optional(),
  numberOfInstalments: z.number().int().positive().optional(),
  instalmentAmount: z.number().positive().optional(),
  startDate: z.coerce.date().optional(),
  status: PAYMENT_PLAN_STATUS.optional(),
});

// ── Phase 18D — POST /v1/payment-plans/generate ──────────────────────────────
//
// Drives `payment-plans.service.generatePlan`. Defaults match the
// service-layer defaults: MONTHLY frequency, persist mutations on
// the resulting plan, INSTALMENT_PLAN as the planType when none is
// supplied. Operators running the preview path get the schedule
// breakdown without persisting — useful for "what would a 9-month
// plan look like?" reporting before committing.
export const generateSchema = z
  .object({
    studentAccountId: z.string().min(1),
    planType: z.string().min(1).optional(),
    totalAmount: z.number().positive(),
    numberOfInstalments: z.number().int().positive(),
    startDate: z.coerce.date(),
    frequency: FREQUENCY.optional(),
    customDates: z.array(z.coerce.date()).optional(),
    initialStatus: PAYMENT_PLAN_STATUS.optional(),
    persist: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.frequency !== 'CUSTOM' ||
      (data.customDates && data.customDates.length === data.numberOfInstalments),
    {
      message: 'CUSTOM frequency requires customDates.length === numberOfInstalments',
      path: ['customDates'],
    },
  );
