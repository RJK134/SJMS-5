import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

const INVOICE_STATUS = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'WRITTEN_OFF',
]);

const CHARGE_TYPE = z.enum([
  'TUITION',
  'BENCH_FEE',
  'RESIT',
  'LATE_FEE',
  'LIBRARY_FINE',
  'ACCOMMODATION',
  'OTHER',
]);

const CHARGE_STATUS = z.enum([
  'PENDING',
  'INVOICED',
  'PAID',
  'CREDITED',
  'WRITTEN_OFF',
]);

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('issueDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  studentAccountId: z.string().optional(),
  status: INVOICE_STATUS.optional(),
  invoiceNumber: z.string().optional(),
});

export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  totalAmount: z.number().nonnegative(),
  status: INVOICE_STATUS.optional(),
});

export const updateSchema = z.object({
  invoiceNumber: z.string().min(1).optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  totalAmount: z.number().nonnegative().optional(),
  paidAmount: z.number().nonnegative().optional(),
  status: INVOICE_STATUS.optional(),
  sentDate: z.coerce.date().optional(),
});

// ── Phase 18B — POST /v1/invoices/generate ──────────────────────────────────
//
// Drives `invoices.service.generateForFeeAssessment`. Defaults match the
// service-layer defaults: preview-only, deterministic invoice number,
// 30-day default due window, GBP currency, single TUITION line for the
// finalFee. Operators running the persist path get an upserted Invoice
// + ChargeLine row set through the new repository helper so audit +
// invoice.created / invoice.generated events fire on their normal
// paths.
export const generateSchema = z.object({
  feeAssessmentId: z.string().min(1),
  /** Optional explicit StudentAccount ID. Auto-resolved from the FeeAssessment's enrolment when omitted. */
  studentAccountId: z.string().optional(),
  /** Optional explicit issueDate. Defaults to "now". */
  issueDate: z.coerce.date().optional(),
  /** Optional explicit dueDate. Defaults to issueDate + rules.defaultDueDays. */
  dueDate: z.coerce.date().optional(),
  /** Currency code. Defaults to "GBP". */
  currency: z.string().min(3).max(3).optional(),
  /** Override the deterministic invoice number (e.g. for a force-regenerate replacement). */
  invoiceNumber: z.string().optional(),
  /** Optional rule overrides forwarded to the pure utility. */
  rules: z.object({
    defaultDueDays: z.number().int().positive().max(365).optional(),
    tuitionChargeType: CHARGE_TYPE.optional(),
    tuitionTaxCode: z.string().optional(),
    initialStatus: INVOICE_STATUS.optional(),
    initialLineStatus: CHARGE_STATUS.optional(),
  }).optional(),
  /** Persist an Invoice + ChargeLine row set. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override: regenerate even when an Invoice with the deterministic number already exists. */
  force: z.boolean().optional(),
});
