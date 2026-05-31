import { z } from 'zod';

/**
 * Phase 1E — POST /v1/ledger-anomalies/scan
 *
 * On-demand ledger anomaly scan. All fields optional — the defaults match
 * the service + repository defaults. Read-only operation; no entity is
 * created or mutated.
 */
export const scanSchema = z.object({
  /** Cap on rows fetched per anomaly class. */
  limit: z.number().int().positive().max(10000).optional(),
  /** Negative balances at or beyond this magnitude (£) are classified HIGH. */
  negativeBalanceHighThreshold: z.number().nonnegative().optional(),
});
