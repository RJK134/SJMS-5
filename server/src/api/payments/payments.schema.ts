import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const PAYMENT_STATUS = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'REFUNDED']);
// Fix 4: REVERSED and REFUNDED are removed from the PATCH surface because no
// reversal / refund pipeline exists yet. Exposing those status values would let
// the API persist a financially-impossible state (ChargeLines stay PAID, invoice
// paidAmount is not reduced, and the StudentAccount ledger is not restored).
// They remain in PAYMENT_STATUS (used for reads/creates) so existing rows can
// be fetched; only PATCH is restricted to the three safe mutation values.
const UPDATE_PAYMENT_STATUS = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
const PAYMENT_METHOD = z.enum([
  'BANK_TRANSFER',
  'CARD',
  'DIRECT_DEBIT',
  'CASH',
  'SLC',
  'SPONSOR',
  'OTHER',
]);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('transactionDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  studentAccountId: z.string().optional(),
  invoiceId: z.string().optional(),
  status: PAYMENT_STATUS.optional(),
  paymentMethod: PAYMENT_METHOD.optional(),
});

export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  invoiceId: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: PAYMENT_METHOD,
  reference: z.string().optional(),
  transactionDate: z.coerce.date(),
  status: PAYMENT_STATUS.optional(),
});

export const updateSchema = z.object({
  invoiceId: z.string().nullable().optional(),
  amount: z.number().positive().optional(),
  paymentMethod: PAYMENT_METHOD.optional(),
  reference: z.string().nullable().optional(),
  transactionDate: z.coerce.date().optional(),
  status: UPDATE_PAYMENT_STATUS.optional(),
});

// ── Phase 18C — POST /v1/payments/:id/allocate ──────────────────────────────
//
// Drives `payments.service.allocateForPayment`. Defaults match the
// service-layer defaults: FIFO strategy, persist mutations on the
// COMPLETED payment, refuse to allocate non-COMPLETED payments
// without `force: true`. Operators running the preview path get the
// allocation breakdown without touching ChargeLine / Invoice /
// StudentAccount state — useful for "what would this payment cover?"
// reporting.
export const allocateSchema = z.object({
  /** Allocation strategy. Defaults to FIFO. */
  strategy: z.enum(['FIFO', 'PROPORTIONAL']).optional(),
  /** Persist the allocation (charge status flips + invoice/account ledger updates). Defaults to true. */
  persist: z.boolean().optional(),
  /** Operator override: allocate even when the payment is not in COMPLETED status. */
  force: z.boolean().optional(),
});
