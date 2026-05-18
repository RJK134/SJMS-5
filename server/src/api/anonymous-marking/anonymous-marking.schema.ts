import { z } from 'zod';

// ── Workstream C3 — anonymous-marking endpoint schemas ──────────────────────

export const paramsSchema = z.object({ id: z.string().min(1) });

export const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  sort: z.string().default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  assessmentId: z.string().optional(),
  studentId: z.string().optional(),
  /** Filter by reveal status. */
  revealed: z.coerce.boolean().optional(),
});

/**
 * POST /v1/anonymous-marking/:id/reveal body schema.
 *
 * Justification is required and must be a non-empty trimmed string —
 * the schema-level guard rejects an empty payload before the request
 * reaches the service layer. The justification is captured on the
 * AuditLog row and the emitted webhook payload (the schema has no
 * `justification` column).
 */
export const revealSchema = z.object({
  justification: z.string().trim().min(1, 'Justification is required to reveal an anonymous marker.'),
});
