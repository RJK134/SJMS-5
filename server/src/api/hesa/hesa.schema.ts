import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  status: z.enum(['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED']).optional(),
});

export const createSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  changeType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const updateSchema = z.object({
  status: z.enum(['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED']).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ── Workstream C2 — HESA return composition / validation / export ──────────

export const HESA_RETURN_TYPES = ['STUDENT', 'COURSE', 'MODULE', 'STAFF', 'DATA_FUTURES'] as const;
export const VALIDATION_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const;

const academicYearShape = z
  .string()
  .regex(/^\d{4}\/\d{2}$/, 'academicYear must match YYYY/YY (e.g. 2025/26).');

const ruleOverrideShape = z
  .array(
    z.object({
      id: z.string().min(1),
      ruleCode: z.string().min(1),
      description: z.string(),
      entityType: z.string().min(1),
      fieldName: z.string().min(1),
      validationType: z.string().min(1),
      expectedValues: z.unknown().optional(),
      severity: z.enum(VALIDATION_SEVERITIES),
      isActive: z.boolean().default(true),
    }),
  )
  .optional();

export const composeReturnSchema = z.object({
  academicYear: academicYearShape,
  returnType: z.enum(HESA_RETURN_TYPES),
  returnId: z.string().min(1).optional(),
  persist: z.boolean().optional(),
  includeInactiveRules: z.boolean().optional(),
  ruleOverride: ruleOverrideShape,
});

export const validateReturnSchema = z.object({
  includeInactiveRules: z.boolean().optional(),
  ruleOverride: ruleOverrideShape,
  persist: z.boolean().optional(),
});

export const exportReturnQuerySchema = z.object({
  format: z.enum(['csv']).default('csv'),
});
