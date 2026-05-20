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

// Phase 1D — REGISTRY proposes. `status` is forced REQUESTED in the service
// regardless of what the client sends; the schema declines `status` entirely
// so callers can't even attempt to side-load it.
export const createSchema = z.object({
  studentAccountId: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(1),
});

// Phase 1D — generic PATCH is SUPER_ADMIN-only (used for clerical correction
// of free-text fields before a decision lands). Decision transitions go
// through the dedicated `/approve`, `/reject`, `/process` endpoints so
// segregation of duties is enforceable.
export const updateSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().min(1).optional(),
  approvedBy: z.string().nullable().optional(),
  approvedDate: z.coerce.date().nullable().optional(),
  processedDate: z.coerce.date().nullable().optional(),
  status: REFUND_STATUS.optional(),
});

// Phase 1D — reject payload carries an optional reason; an empty body is OK
// (a curt rejection with no rationale still beats an undocumented one).
export const rejectSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

// Phase 1D — approve and process take no payload (the actor identity and
// timestamp are set server-side from the auth context). We still validate an
// empty object so the middleware behaviour stays consistent across routes.
export const approveSchema = z.object({}).strict();
export const processSchema = z.object({}).strict();
