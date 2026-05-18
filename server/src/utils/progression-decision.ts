/**
 * Phase 17D — Progression decisioning pure utility.
 *
 * Given a year's worth of ModuleResults plus the programme level and the
 * student's year of study, decides whether the student should:
 *
 *   - PROGRESS         passed enough credits at the required level
 *   - REPEAT_MODULES   some modules failed but passing the year is recoverable
 *                      under compensation rules
 *   - REPEAT_YEAR      substantial failures; student must repeat the whole year
 *   - WITHDRAW         too far below threshold to recover; recommend exit
 *   - TRANSFER         outside this utility's responsibility — never returned
 *                      automatically; only present in the enum so the service
 *                      layer can accept it as an operator override
 *   - AWARD            final year, eligible for an award (delegated to the
 *                      classification utility — never returned by this
 *                      decisioner alone)
 *
 * The decision values match the canonical `ProgressionDecision` enum in
 * `prisma/schema.prisma`.
 *
 * Pure — no Prisma, no file system, no network. The companion service layer
 * (`progressions.service::decideForEnrolmentYear`) loads the inputs and
 * persists the outcome.
 *
 * Default rules (UK HE convention) are used when the caller does not supply
 * explicit rules. They can be overridden per-call via the `rules` argument
 * so a future batch can wire ProgressionRule rows from the database without
 * changing this utility's contract.
 */

/** Per-module result projection consumed by the decisioner. */
export interface ModuleResultForProgression {
  /** ModuleResult id (for reporting; not used in the calculation). */
  id: string;
  /** Module id (for reporting; not used in the calculation). */
  moduleId: string;
  /** Credit value of the underlying Module — drives credit-pass accounting. */
  credits: number;
  /** Aggregate percentage from 17A; null when not yet aggregated. */
  aggregateMark: number | null;
  /**
   * Whether the result represents a pass for credit purposes. The 17A pipeline
   * does not record a boolean directly — the decisioner derives the pass flag
   * from `aggregateMark >= passMark` when supplied, and falls back to `true`
   * for non-numeric results that carry a passing `grade` such as `PASS`.
   * Caller responsibility to pre-classify is intentional: it keeps this
   * utility free of grade-string semantics.
   */
  isPass: boolean;
}

/** Programme levels the decisioner understands. Mirrors the schema enum. */
export type ProgrammeLevel = 'LEVEL_3' | 'LEVEL_4' | 'LEVEL_5' | 'LEVEL_6' | 'LEVEL_7' | 'LEVEL_8';

/** Decision values the utility can return — subset of the Prisma enum. */
export type ProgressionDecisionValue =
  | 'PROGRESS'
  | 'REPEAT_MODULES'
  | 'REPEAT_YEAR'
  | 'WITHDRAW'
  | 'AWARD';

/** Optional rule overrides; defaults capture standard UK HE behaviour. */
export interface ProgressionRules {
  /** Credits required to count as a full-year pass. UK convention: 120. */
  fullYearCredits?: number;
  /**
   * Credits that may be carried (compensation) and still allow a PROGRESS
   * decision. Default 0 — institutions that allow compensation must opt in.
   */
  maxCompensatedCredits?: number;
  /**
   * Minimum percentage on a *failed* module that still allows compensation.
   * Default 30 — below this, the failure is treated as substantive even
   * if the credits would otherwise compensate.
   */
  compensationMinMark?: number;
  /**
   * Threshold below which the decision becomes WITHDRAW rather than
   * REPEAT_YEAR. Default 0.5 — i.e. fewer than half the year's credits
   * passed. Expressed as a fraction of `fullYearCredits`.
   */
  withdrawThresholdRatio?: number;
}

/** Inputs to the decisioner. */
export interface ProgressionInput {
  moduleResults: ModuleResultForProgression[];
  programmeLevel: ProgrammeLevel;
  yearOfStudy: number;
  /** True when this year is the final year of the programme. Defaults to false. */
  isFinalYear?: boolean;
  /** Optional rule overrides. */
  rules?: ProgressionRules;
}

/** Outcome shape returned by the decisioner. */
export interface ProgressionOutcome {
  decision: ProgressionDecisionValue;
  totalCreditsAttempted: number;
  totalCreditsPassed: number;
  totalCreditsFailed: number;
  /** Weighted-by-credit average percentage across module results that have an aggregateMark. Null when no marks contribute. */
  averageMark: number | null;
  /** Human-readable reason explaining the decision — useful for audit and UI. */
  reason: string;
  /** Module ids that contributed a fail; useful for the operator UI. */
  failedModuleIds: string[];
  /** Module ids whose credits were compensated (failed but inside the compensation envelope). */
  compensatedModuleIds: string[];
  /** Rules effectively applied (defaults plus overrides), captured for audit traceability. */
  effectiveRules: Required<ProgressionRules>;
}

const DEFAULT_RULES: Required<ProgressionRules> = {
  fullYearCredits: 120,
  maxCompensatedCredits: 0,
  compensationMinMark: 30,
  withdrawThresholdRatio: 0.5,
};

/** Round a number to two decimal places without floating-point artefacts. */
function roundToTwoDp(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Decide a progression outcome for a year. Pure — does NOT touch Prisma.
 * Returns a structured outcome the service layer can persist as a
 * ProgressionRecord row.
 */
export function decideProgression(input: ProgressionInput): ProgressionOutcome {
  const rules: Required<ProgressionRules> = { ...DEFAULT_RULES, ...(input.rules ?? {}) };

  // Credit accounting — count attempted (= every result row), passed
  // (isPass = true), and failed (isPass = false) credits separately.
  let totalCreditsAttempted = 0;
  let totalCreditsPassed = 0;
  const failedModuleIds: string[] = [];

  for (const r of input.moduleResults) {
    if (r.credits <= 0) continue;
    totalCreditsAttempted += r.credits;
    if (r.isPass) {
      totalCreditsPassed += r.credits;
    } else {
      failedModuleIds.push(r.moduleId);
    }
  }
  const totalCreditsFailed = totalCreditsAttempted - totalCreditsPassed;

  // Weighted-by-credit average across only the rows that have an
  // aggregateMark recorded. Modules without a mark do not drag the
  // average down (mirrors the 17A "missing component, no silent zero"
  // contract).
  let weightedSum = 0;
  let contributingCredits = 0;
  for (const r of input.moduleResults) {
    if (r.aggregateMark == null || r.credits <= 0) continue;
    weightedSum += r.aggregateMark * r.credits;
    contributingCredits += r.credits;
  }
  const averageMark =
    contributingCredits > 0 ? roundToTwoDp(weightedSum / contributingCredits) : null;

  // Empty cohort — no decision can be made. Surface as REPEAT_YEAR with
  // an explicit reason; the service layer treats this as preview-only.
  if (totalCreditsAttempted === 0) {
    return {
      decision: 'REPEAT_YEAR',
      totalCreditsAttempted: 0,
      totalCreditsPassed: 0,
      totalCreditsFailed: 0,
      averageMark: null,
      reason: 'No credit-bearing module results recorded for this year — cannot decide progression.',
      failedModuleIds: [],
      compensatedModuleIds: [],
      effectiveRules: rules,
    };
  }

  // Compensation — failed credits inside the compensation envelope where
  // the underlying mark is at or above `compensationMinMark` are treated
  // as "compensable" and effectively counted toward the pass total for the
  // PROGRESS decision. Failures below `compensationMinMark` always count
  // as substantive.
  let compensatedCredits = 0;
  const compensatedModuleIds: string[] = [];
  if (rules.maxCompensatedCredits > 0) {
    for (const r of input.moduleResults) {
      if (r.isPass || r.credits <= 0) continue;
      if (r.aggregateMark == null) continue;
      if (r.aggregateMark < rules.compensationMinMark) continue;
      if (compensatedCredits + r.credits > rules.maxCompensatedCredits) continue;
      compensatedCredits += r.credits;
      compensatedModuleIds.push(r.moduleId);
    }
  }
  const effectiveCreditsPassed = totalCreditsPassed + compensatedCredits;

  // Final-year completion → AWARD. Award classification is delegated to
  // the classification utility; this decisioner only reports that the
  // year was completed and the student is eligible.
  if (input.isFinalYear && effectiveCreditsPassed >= rules.fullYearCredits) {
    return {
      decision: 'AWARD',
      totalCreditsAttempted,
      totalCreditsPassed,
      totalCreditsFailed,
      averageMark,
      reason:
        `Final year completed: ${effectiveCreditsPassed}/${rules.fullYearCredits} credits passed` +
        (compensatedCredits > 0 ? ` (including ${compensatedCredits} compensated)` : '') +
        '. Eligible for award classification.',
      failedModuleIds,
      compensatedModuleIds,
      effectiveRules: rules,
    };
  }

  // Standard PROGRESS — full credit total reached (with or without
  // compensation), and not the final year.
  if (effectiveCreditsPassed >= rules.fullYearCredits) {
    return {
      decision: 'PROGRESS',
      totalCreditsAttempted,
      totalCreditsPassed,
      totalCreditsFailed,
      averageMark,
      reason:
        `Year passed: ${effectiveCreditsPassed}/${rules.fullYearCredits} credits passed` +
        (compensatedCredits > 0 ? ` (including ${compensatedCredits} compensated)` : '') +
        '.',
      failedModuleIds,
      compensatedModuleIds,
      effectiveRules: rules,
    };
  }

  // Below the WITHDRAW threshold — too far below to recover.
  const withdrawThresholdCredits = rules.fullYearCredits * rules.withdrawThresholdRatio;
  if (totalCreditsPassed < withdrawThresholdCredits) {
    return {
      decision: 'WITHDRAW',
      totalCreditsAttempted,
      totalCreditsPassed,
      totalCreditsFailed,
      averageMark,
      reason:
        `Insufficient credits passed: ${totalCreditsPassed}/${rules.fullYearCredits}` +
        ` (below the ${Math.round(rules.withdrawThresholdRatio * 100)}% threshold of ${withdrawThresholdCredits} credits). Recommend withdrawal.`,
      failedModuleIds,
      compensatedModuleIds,
      effectiveRules: rules,
    };
  }

  // Between thresholds — REPEAT_MODULES if at least one failure is
  // compensable in principle (i.e. the student is close enough that
  // re-sitting individual modules is the path forward); REPEAT_YEAR
  // otherwise.
  const hasModerateFailures = failedModuleIds.length > 0 && failedModuleIds.length <= 2;
  const decision: ProgressionDecisionValue = hasModerateFailures ? 'REPEAT_MODULES' : 'REPEAT_YEAR';
  return {
    decision,
    totalCreditsAttempted,
    totalCreditsPassed,
    totalCreditsFailed,
    averageMark,
    reason:
      decision === 'REPEAT_MODULES'
        ? `${totalCreditsPassed}/${rules.fullYearCredits} credits passed; ${failedModuleIds.length} module(s) failed and may be re-sat.`
        : `${totalCreditsPassed}/${rules.fullYearCredits} credits passed; substantive failures across ${failedModuleIds.length} module(s) — full year repeat recommended.`,
    failedModuleIds,
    compensatedModuleIds,
    effectiveRules: rules,
  };
}
