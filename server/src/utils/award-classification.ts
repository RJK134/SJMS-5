/**
 * Phase 17D — Award classification pure utility.
 *
 * Computes a final-award classification from a student's full body of
 * ModuleResults. Pure — no Prisma, no I/O. The companion service layer
 * (`awards.service::classifyForEnrolment`) loads the inputs and persists
 * the AwardRecord.
 *
 * Default rules follow standard UK HE practice:
 *
 *   Honours degrees (LEVEL_6 — UG honours):
 *     >= 70%  FIRST
 *     >= 60%  UPPER_SECOND       ("2:1")
 *     >= 50%  LOWER_SECOND       ("2:2")
 *     >= 40%  THIRD
 *     <  40%  FAIL
 *
 *   Postgraduate taught (LEVEL_7):
 *     >= 70%  DISTINCTION
 *     >= 60%  MERIT
 *     >= 50%  PASS
 *     <  50%  FAIL
 *
 *   Sub-honours (LEVEL_3 — LEVEL_5):
 *     >= 40%  PASS
 *     <  40%  FAIL
 *
 *   Doctoral (LEVEL_8): not classified by simple weighted average — this
 *     utility refuses to classify doctoral programmes and returns FAIL
 *     with an explicit reason. Operators must produce a manual outcome.
 *
 * The classification values match the canonical `AwardClassification`
 * enum in `prisma/schema.prisma`. Rules can be overridden per-call via
 * the `rules` argument so a future batch can wire ClassificationRule
 * rows from the database without changing this utility's contract.
 *
 * Final-year weighting: by default, the average is computed across every
 * supplied ModuleResult weighted by credit value. Many institutions weight
 * the final year more heavily (e.g. final year 60% / penultimate 40%);
 * such weighting is the caller's responsibility — this utility takes the
 * weighting decision as input rather than embedding institutional policy.
 */

/** Per-module result projection consumed by the classifier. */
export interface ModuleResultForClassification {
  id: string;
  moduleId: string;
  credits: number;
  /** Aggregate percentage from 17A; null when not yet aggregated. */
  aggregateMark: number | null;
  /** Programme level the module sits at — used to filter to honours-relevant modules. */
  level: number;
  /**
   * Optional explicit weight to apply to this module's contribution. When
   * omitted, the classifier uses the credit value as the weight (i.e. a
   * pure credit-weighted average). The caller can pre-compute final-year
   * uplifts (e.g. doubling final-year weights) by setting `weight`
   * directly.
   */
  weight?: number;
}

/** Classification values the utility can return — subset of the Prisma enum. */
export type AwardClassificationValue =
  | 'FIRST'
  | 'UPPER_SECOND'
  | 'LOWER_SECOND'
  | 'THIRD'
  | 'PASS'
  | 'FAIL'
  | 'DISTINCTION'
  | 'MERIT';

/** Programme levels the classifier supports. */
export type ClassifierProgrammeLevel = 'LEVEL_3' | 'LEVEL_4' | 'LEVEL_5' | 'LEVEL_6' | 'LEVEL_7' | 'LEVEL_8';

/** Optional rule overrides — defaults capture standard UK HE practice. */
export interface ClassificationRules {
  /** Honours-degree boundaries, descending. Each entry: average mark threshold and the resulting classification. */
  honoursBoundaries?: ReadonlyArray<{ minAverageMark: number; classification: AwardClassificationValue }>;
  /** PG-taught (LEVEL_7) boundaries, descending. */
  pgtBoundaries?: ReadonlyArray<{ minAverageMark: number; classification: AwardClassificationValue }>;
  /** Sub-honours (LEVEL_3 to LEVEL_5) pass mark. Anything below is FAIL. */
  subHonoursPassMark?: number;
}

/** Inputs to the classifier. */
export interface ClassificationInput {
  moduleResults: ModuleResultForClassification[];
  programmeLevel: ClassifierProgrammeLevel;
  /** Optional rule overrides. */
  rules?: ClassificationRules;
}

/** Outcome returned by the classifier. */
export interface ClassificationOutcome {
  classification: AwardClassificationValue;
  /** Weighted average across modules with an aggregateMark — two decimal places. Null when no modules contribute. */
  finalAverage: number | null;
  /** Number of credits considered (sum of `credits` for contributing rows). */
  totalCreditsConsidered: number;
  /** Number of modules whose mark contributed to the average. */
  contributingModuleCount: number;
  /** Module ids that did not contribute (e.g. missing aggregateMark). */
  excludedModuleIds: string[];
  /** Human-readable reason for the outcome. */
  reason: string;
  /** Effective rules applied (defaults plus overrides). */
  effectiveRules: Required<ClassificationRules>;
}

const DEFAULT_HONOURS_BOUNDARIES: ReadonlyArray<{ minAverageMark: number; classification: AwardClassificationValue }> = [
  { minAverageMark: 70, classification: 'FIRST' },
  { minAverageMark: 60, classification: 'UPPER_SECOND' },
  { minAverageMark: 50, classification: 'LOWER_SECOND' },
  { minAverageMark: 40, classification: 'THIRD' },
];

const DEFAULT_PGT_BOUNDARIES: ReadonlyArray<{ minAverageMark: number; classification: AwardClassificationValue }> = [
  { minAverageMark: 70, classification: 'DISTINCTION' },
  { minAverageMark: 60, classification: 'MERIT' },
  { minAverageMark: 50, classification: 'PASS' },
];

const DEFAULT_SUB_HONOURS_PASS_MARK = 40;

const DEFAULT_RULES: Required<ClassificationRules> = {
  honoursBoundaries: DEFAULT_HONOURS_BOUNDARIES,
  pgtBoundaries: DEFAULT_PGT_BOUNDARIES,
  subHonoursPassMark: DEFAULT_SUB_HONOURS_PASS_MARK,
};

function roundToTwoDp(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Apply a descending boundary table to a numeric average. Returns the
 * first boundary the average meets, or null if none match (which the
 * caller treats as FAIL).
 */
function applyBoundaries(
  average: number,
  boundaries: ReadonlyArray<{ minAverageMark: number; classification: AwardClassificationValue }>,
): AwardClassificationValue | null {
  for (const b of boundaries) {
    if (average >= b.minAverageMark) return b.classification;
  }
  return null;
}

/**
 * Classify an enrolment's award outcome. Pure — does NOT touch Prisma.
 * Returns a structured outcome the service layer can persist as an
 * AwardRecord row.
 */
export function classifyAward(input: ClassificationInput): ClassificationOutcome {
  const rules: Required<ClassificationRules> = { ...DEFAULT_RULES, ...(input.rules ?? {}) };

  // Doctoral — not classifiable by weighted average. Refuse with an
  // explicit reason rather than guessing.
  if (input.programmeLevel === 'LEVEL_8') {
    return {
      classification: 'FAIL',
      finalAverage: null,
      totalCreditsConsidered: 0,
      contributingModuleCount: 0,
      excludedModuleIds: input.moduleResults.map((r) => r.moduleId),
      reason: 'LEVEL_8 (doctoral) programmes are not classified by weighted average; manual classification is required.',
      effectiveRules: rules,
    };
  }

  // Weighted average across rows with an aggregateMark. Modules without a
  // mark are excluded and reported in `excludedModuleIds`. The default
  // weight is the module's credit value; callers wanting a final-year
  // uplift supply explicit `weight` per row.
  let weightedSum = 0;
  let totalWeight = 0;
  let totalCreditsConsidered = 0;
  let contributingModuleCount = 0;
  const excludedModuleIds: string[] = [];

  for (const r of input.moduleResults) {
    if (r.aggregateMark == null || r.credits <= 0) {
      excludedModuleIds.push(r.moduleId);
      continue;
    }
    const weight = r.weight ?? r.credits;
    if (weight <= 0) {
      excludedModuleIds.push(r.moduleId);
      continue;
    }
    weightedSum += r.aggregateMark * weight;
    totalWeight += weight;
    totalCreditsConsidered += r.credits;
    contributingModuleCount += 1;
  }

  if (totalWeight === 0) {
    return {
      classification: 'FAIL',
      finalAverage: null,
      totalCreditsConsidered: 0,
      contributingModuleCount: 0,
      excludedModuleIds,
      reason: 'No module results with a recorded aggregateMark — cannot classify.',
      effectiveRules: rules,
    };
  }

  const finalAverage = roundToTwoDp(weightedSum / totalWeight);

  // Honours degree (UG L6) → honours boundaries.
  if (input.programmeLevel === 'LEVEL_6') {
    const matched = applyBoundaries(finalAverage, rules.honoursBoundaries);
    return {
      classification: matched ?? 'FAIL',
      finalAverage,
      totalCreditsConsidered,
      contributingModuleCount,
      excludedModuleIds,
      reason: matched
        ? `Final average ${finalAverage}% meets the ${matched} threshold for an honours degree.`
        : rules.honoursBoundaries.length > 0
          ? `Final average ${finalAverage}% is below the honours pass threshold of ${
              rules.honoursBoundaries[rules.honoursBoundaries.length - 1].minAverageMark
            }%.`
          : `Final average ${finalAverage}% does not meet any honours classification threshold (no boundaries configured).`,
      effectiveRules: rules,
    };
  }

  // PG-taught (L7) → distinction/merit/pass boundaries.
  if (input.programmeLevel === 'LEVEL_7') {
    const matched = applyBoundaries(finalAverage, rules.pgtBoundaries);
    return {
      classification: matched ?? 'FAIL',
      finalAverage,
      totalCreditsConsidered,
      contributingModuleCount,
      excludedModuleIds,
      reason: matched
        ? `Final average ${finalAverage}% meets the ${matched} threshold for a postgraduate taught award.`
        : rules.pgtBoundaries.length > 0
          ? `Final average ${finalAverage}% is below the postgraduate pass threshold of ${
              rules.pgtBoundaries[rules.pgtBoundaries.length - 1].minAverageMark
            }%.`
          : `Final average ${finalAverage}% does not meet any postgraduate classification threshold (no boundaries configured).`,
      effectiveRules: rules,
    };
  }

  // Sub-honours (L3-L5) → flat PASS / FAIL.
  const passMark = rules.subHonoursPassMark;
  if (finalAverage >= passMark) {
    return {
      classification: 'PASS',
      finalAverage,
      totalCreditsConsidered,
      contributingModuleCount,
      excludedModuleIds,
      reason: `Final average ${finalAverage}% is at or above the sub-honours pass mark (${passMark}%).`,
      effectiveRules: rules,
    };
  }
  return {
    classification: 'FAIL',
    finalAverage,
    totalCreditsConsidered,
    contributingModuleCount,
    excludedModuleIds,
    reason: `Final average ${finalAverage}% is below the sub-honours pass mark (${passMark}%).`,
    effectiveRules: rules,
  };
}
