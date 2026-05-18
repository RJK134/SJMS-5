import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  studentId: z.string().optional(), programmeId: z.string().optional(), status: z.string().optional(),
});

export const createSchema = z.object({
  studentId: z.string().min(1), enrolmentId: z.string().min(1), programmeId: z.string().min(1),
    awardTitle: z.string().min(1), classification: z.string().optional(),
    totalCredits: z.number().int(), status: z.enum(['RECOMMENDED','APPROVED','CONFERRED','REVOKED']).default('RECOMMENDED'),
});

export const updateSchema = createSchema.partial();

// ── Phase 17D — POST /v1/awards/classify ────────────────────────────────────
//
// Drives `awards.service.classifyForEnrolment`. Defaults match the
// service-layer defaults: preview-only, CONFIRMED-only ModuleResults
// considered. Persist mode upserts an AwardRecord (RECOMMENDED status)
// through the existing create/update path.
export const classifySchema = z.object({
  enrolmentId: z.string().min(1),
  /** Optional rule overrides for honours / PG-taught / sub-honours boundaries. */
  rules: z.object({
    honoursBoundaries: z.array(
      z.object({
        minAverageMark: z.number().min(0).max(100),
        classification: z.enum(['FIRST', 'UPPER_SECOND', 'LOWER_SECOND', 'THIRD', 'PASS', 'FAIL', 'DISTINCTION', 'MERIT']),
      }),
    ).min(1).optional(),
    pgtBoundaries: z.array(
      z.object({
        minAverageMark: z.number().min(0).max(100),
        classification: z.enum(['FIRST', 'UPPER_SECOND', 'LOWER_SECOND', 'THIRD', 'PASS', 'FAIL', 'DISTINCTION', 'MERIT']),
      }),
    ).min(1).optional(),
    subHonoursPassMark: z.number().min(0).max(100).optional(),
  }).optional(),
  /** Persist an AwardRecord row. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override for empty / no-mark inputs on the persist path. */
  force: z.boolean().optional(),
});
