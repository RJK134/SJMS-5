import { z } from 'zod';

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  // studentId is injected by scopeToUser('studentId') for the student
  // portal — must remain accepted by the schema or the filter is
  // silently dropped. Same pattern as marks.schema.
  studentId: z.string().optional(),
  transcriptType: z.string().optional(),
});

export const createSchema = z.object({
  studentId: z.string().min(1),
    transcriptType: z.enum(['INTERIM','FINAL','REPLACEMENT']),
    generatedDate: z.coerce.date(),
});

export const updateSchema = createSchema.partial();

// ── Phase 17E — POST /v1/transcripts/compose ─────────────────────────────
//
// Drives `transcripts.service.composeForStudent`. Defaults: INTERIM,
// preview-only. Persist mode atomically writes a Transcript row plus
// its TranscriptLine children; FINAL persist requires an AwardRecord
// (or `force: true` for operational repair).
export const composeSchema = z.object({
  studentId: z.string().min(1),
  /** Defaults to INTERIM. FINAL requires an AwardRecord on the persist path. */
  transcriptType: z.enum(['INTERIM', 'FINAL', 'REPLACEMENT']).optional(),
  /** Restrict the composition to a specific enrolment; defaults to the most recent. */
  enrolmentId: z.string().min(1).optional(),
  /** Persist a Transcript + TranscriptLine row set. Defaults to false (preview only). */
  persist: z.boolean().optional(),
  /** Operator override of the FINAL precondition on the persist path. */
  force: z.boolean().optional(),
});
