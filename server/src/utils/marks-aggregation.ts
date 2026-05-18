/**
 * Phase 17A — Marks aggregation pure utility.
 *
 * Deterministic, side-effect-free helper for rolling per-assessment marks up
 * into a single module-level percentage. Lives outside the service layer
 * deliberately so the rule can be unit-tested in isolation and reused by
 * later batches (17C module result generation, 17D classification) without
 * introducing fan-out into infrastructure code.
 *
 * The algorithm follows standard UK HE convention:
 *
 *   percentage_i = (finalMark_i / maxMark_i) * 100
 *   contribution_i = percentage_i * (weighting_i / sum(weightings))
 *   aggregate = round(sum(contribution_i), 2)
 *
 * Weightings are NOT assumed to total 100. The implementation normalises by
 * the sum of weightings present in the supplied attempts, which keeps the
 * helper honest when (a) the caller deliberately submits a partial cohort
 * for preview, (b) some assessments are weighted out for a particular
 * cohort, or (c) the schema's per-Assessment weighting field has drifted
 * from the institutional 100% expectation. The function reports the actual
 * `totalWeighting` it observed so the caller can decide whether to treat the
 * aggregate as final or provisional. The companion service layer enforces
 * the 100% rule when the caller asks for persistence.
 *
 * Missing finalMark values are excluded from both the numerator and the
 * normalising denominator (their weighting does NOT count) and are reported
 * back via `missingAssessmentIds` and `isComplete=false`. This avoids the
 * silent-zero failure mode where a missing component is treated as a fail
 * and drags the average down without warning.
 *
 * Rounding is applied once at the end, to two decimal places, matching the
 * `Decimal(6, 2)` precision on the relevant Prisma columns
 * (`AssessmentAttempt.finalMark`, `ModuleResult.aggregateMark`).
 */

export interface AttemptForAggregation {
  /** Assessment id this attempt belongs to (for reporting / boundary lookup). */
  assessmentId: string;
  /** Final mark recorded on the attempt; may be null when not yet marked. */
  finalMark: number | null;
  /** Maximum mark configured on the assessment (denominator for the percentage). */
  maxMark: number;
  /** Weighting configured on the assessment (numerator share). */
  weighting: number;
}

export interface AggregationResult {
  /**
   * Weighted-average percentage across the attempts that had a finalMark.
   * Two decimal places. `null` when no contributing attempts were supplied.
   */
  aggregatePercentage: number | null;
  /** Sum of weightings on attempts that contributed a finalMark. */
  totalWeighting: number;
  /** Number of attempts considered (regardless of whether they contributed). */
  componentCount: number;
  /** Number of attempts that contributed a finalMark to the aggregate. */
  contributingCount: number;
  /**
   * True when every supplied attempt contributed to the aggregate. False when
   * one or more attempts were excluded, including missing `finalMark` values
   * or non-contributing inputs such as non-positive `maxMark` / `weighting` —
   * the aggregate is therefore preview-only and should not be persisted as a
   * definitive ModuleResult without operator acknowledgement.
   */
  isComplete: boolean;
  /** Assessment ids whose attempt had a null finalMark. */
  missingAssessmentIds: string[];
}

/** Round to two decimal places without exposing floating-point artefacts. */
function roundToTwoDp(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregate a set of per-assessment attempts into a single module-level
 * percentage using the standard weighted-average rule. Pure — does NOT touch
 * Prisma, the file system, or the network. See the file-level comment for
 * the algorithm and the full set of edge cases it handles.
 *
 * @throws never — invalid inputs (e.g. non-positive weighting, finalMark
 *   exceeding maxMark) are validated by the caller against the existing
 *   service-layer guards (`marks.service.validateMarkBounds`,
 *   `assessments.service` weighting constraints). This helper trusts its
 *   inputs to keep the contract narrow.
 */
export function aggregateMarks(attempts: AttemptForAggregation[]): AggregationResult {
  const componentCount = attempts.length;

  if (componentCount === 0) {
    return {
      aggregatePercentage: null,
      totalWeighting: 0,
      componentCount: 0,
      contributingCount: 0,
      isComplete: false,
      missingAssessmentIds: [],
    };
  }

  let weightedSum = 0;
  let totalWeighting = 0;
  let contributingCount = 0;
  const missingAssessmentIds: string[] = [];

  for (const attempt of attempts) {
    if (attempt.finalMark == null) {
      missingAssessmentIds.push(attempt.assessmentId);
      continue;
    }

    // Guard against a zero / negative maxMark — would otherwise produce
    // Infinity or a negative percentage. The caller's mark-bounds check
    // already rejects this, but we double-belt rather than divide by zero.
    if (attempt.maxMark <= 0) continue;
    // Likewise skip zero-weighted components — they cannot contribute.
    if (attempt.weighting <= 0) continue;

    const percentage = (attempt.finalMark / attempt.maxMark) * 100;
    weightedSum += percentage * attempt.weighting;
    totalWeighting += attempt.weighting;
    contributingCount += 1;
  }

  const aggregatePercentage =
    totalWeighting > 0 ? roundToTwoDp(weightedSum / totalWeighting) : null;

  return {
    aggregatePercentage,
    totalWeighting,
    componentCount,
    contributingCount,
    isComplete: missingAssessmentIds.length === 0 && contributingCount === componentCount,
    missingAssessmentIds,
  };
}
