/**
 * Phase 1C — pure bursary eligibility rule engine.
 *
 * Takes a `BursaryFund.eligibility` JSON blob and a `BursaryApplication`
 * snapshot, returns one of `APPROVE` / `REJECT` / `REVIEW` plus a
 * suggested `awardAmount`, the reasons that drove the decision, and the
 * effective rules in use for audit traceability.
 *
 * Pure: no Prisma, no I/O. Same purity contract as
 * `utils/fee-calculation.ts`, `utils/invoice-composition.ts`, and the
 * other Phase 17/18 rule engines.
 *
 * Decision matrix (in evaluation order):
 *   1. Hard rejects (any of these → REJECT):
 *      - `requiresCircumstancesDesc: true` and the application has none
 *      - `householdIncome` strictly greater than `autoRejectAboveIncome`
 *      - `feeStatusAllowList` set and `application.feeStatus` not in the list
 *      - Fund has zero `remaining` budget and `suggestedAward > 0`
 *   2. Auto-approve (all conditions met → APPROVE):
 *      - `householdIncome` reported AND ≤ `autoApproveBelowIncome`
 *      - `suggestedAward` ≤ fund's `remaining`
 *      - No hard reject fired in step 1
 *   3. Anything else → REVIEW (manual decision required).
 *
 * Suggested award is `min(defaultAwardAmount, maxAwardPerStudent, remaining)`.
 *
 * The function never mutates its inputs and never throws — caller
 * preconditions are checked at the service boundary (e.g. application
 * must be in a non-terminal status). Defensive: missing numeric fields
 * are treated as "unknown" rather than zero so a £0 income reading does
 * not silently auto-approve.
 */

export type BursaryDecision = 'APPROVE' | 'REJECT' | 'REVIEW';

/** Rule shape stored on `BursaryFund.eligibility` (Json column). */
export interface BursaryEligibilityRules {
  /** Reject when `application.householdIncome > autoRejectAboveIncome`. */
  autoRejectAboveIncome?: number;
  /** Approve when `application.householdIncome <= autoApproveBelowIncome`. */
  autoApproveBelowIncome?: number;
  /** Default award amount when the rule produces APPROVE. */
  defaultAwardAmount?: number;
  /** Hard cap on the per-student award amount. */
  maxAwardPerStudent?: number;
  /** When true, application must include a non-empty `circumstancesDesc`. */
  requiresCircumstancesDesc?: boolean;
  /** Optional allow-list of fee statuses (HOME / OVERSEAS / EU_TRANSITIONAL / ISLANDS / CHANNEL_ISLANDS). */
  feeStatusAllowList?: string[];
}

/** Snapshot of the application fields the rule engine reads. */
export interface BursaryApplicationSnapshot {
  id: string;
  status: string;
  householdIncome: number | null;
  circumstancesDesc: string | null;
  feeStatus?: string | null;
}

/** Snapshot of the fund fields the rule engine reads. */
export interface BursaryFundSnapshot {
  id: string;
  fundType: string;
  remaining: number;
  eligibility: BursaryEligibilityRules | null;
}

/** Structured outcome returned by `evaluateBursaryEligibility`. */
export interface BursaryDecisionOutcome {
  decision: BursaryDecision;
  /** Suggested £ award amount. 0 when REJECT or when rules give no default. */
  suggestedAward: number;
  /** Human-readable reasons captured for the audit trail. */
  reasons: string[];
  /** The merged rule set actually used, for audit replay. */
  effectiveRules: Required<
    Omit<BursaryEligibilityRules, 'feeStatusAllowList'>
  > & {
    feeStatusAllowList: string[] | null;
  };
}

const DEFAULT_RULES = {
  autoRejectAboveIncome: 60000,
  autoApproveBelowIncome: 15000,
  defaultAwardAmount: 1000,
  maxAwardPerStudent: 3000,
  requiresCircumstancesDesc: false,
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveRules(rules: BursaryEligibilityRules | null) {
  const r = rules ?? {};
  return {
    autoRejectAboveIncome:
      typeof r.autoRejectAboveIncome === 'number' && r.autoRejectAboveIncome >= 0
        ? r.autoRejectAboveIncome
        : DEFAULT_RULES.autoRejectAboveIncome,
    autoApproveBelowIncome:
      typeof r.autoApproveBelowIncome === 'number' && r.autoApproveBelowIncome >= 0
        ? r.autoApproveBelowIncome
        : DEFAULT_RULES.autoApproveBelowIncome,
    defaultAwardAmount:
      typeof r.defaultAwardAmount === 'number' && r.defaultAwardAmount >= 0
        ? r.defaultAwardAmount
        : DEFAULT_RULES.defaultAwardAmount,
    maxAwardPerStudent:
      typeof r.maxAwardPerStudent === 'number' && r.maxAwardPerStudent >= 0
        ? r.maxAwardPerStudent
        : DEFAULT_RULES.maxAwardPerStudent,
    requiresCircumstancesDesc:
      typeof r.requiresCircumstancesDesc === 'boolean'
        ? r.requiresCircumstancesDesc
        : DEFAULT_RULES.requiresCircumstancesDesc,
    feeStatusAllowList:
      Array.isArray(r.feeStatusAllowList) && r.feeStatusAllowList.length > 0
        ? r.feeStatusAllowList.slice()
        : null,
  };
}

export function evaluateBursaryEligibility(
  application: BursaryApplicationSnapshot,
  fund: BursaryFundSnapshot,
): BursaryDecisionOutcome {
  const effectiveRules = resolveRules(fund.eligibility);
  const reasons: string[] = [];

  const remaining = Math.max(0, round2(fund.remaining));
  const cappedAward = round2(
    Math.min(effectiveRules.defaultAwardAmount, effectiveRules.maxAwardPerStudent),
  );
  const suggestedAward = round2(Math.min(cappedAward, remaining));

  // ── Hard rejects ─────────────────────────────────────────────────────────
  if (
    effectiveRules.requiresCircumstancesDesc &&
    (application.circumstancesDesc == null ||
      application.circumstancesDesc.trim().length === 0)
  ) {
    reasons.push(
      'Fund requires a circumstances description; application has none.',
    );
    return {
      decision: 'REJECT',
      suggestedAward: 0,
      reasons,
      effectiveRules,
    };
  }

  if (
    typeof application.householdIncome === 'number' &&
    application.householdIncome > effectiveRules.autoRejectAboveIncome
  ) {
    reasons.push(
      `Household income £${application.householdIncome} exceeds auto-reject threshold ` +
        `£${effectiveRules.autoRejectAboveIncome}.`,
    );
    return {
      decision: 'REJECT',
      suggestedAward: 0,
      reasons,
      effectiveRules,
    };
  }

  if (
    effectiveRules.feeStatusAllowList &&
    application.feeStatus != null &&
    !effectiveRules.feeStatusAllowList.includes(application.feeStatus)
  ) {
    reasons.push(
      `Fee status ${application.feeStatus} not in fund allow-list ` +
        `[${effectiveRules.feeStatusAllowList.join(', ')}].`,
    );
    return {
      decision: 'REJECT',
      suggestedAward: 0,
      reasons,
      effectiveRules,
    };
  }

  if (suggestedAward === 0 && cappedAward > 0) {
    reasons.push(
      `Fund has no remaining budget (£${remaining} of £${cappedAward} requested).`,
    );
    return {
      decision: 'REJECT',
      suggestedAward: 0,
      reasons,
      effectiveRules,
    };
  }

  // ── Auto-approve ────────────────────────────────────────────────────────
  if (
    typeof application.householdIncome === 'number' &&
    application.householdIncome <= effectiveRules.autoApproveBelowIncome &&
    suggestedAward > 0 &&
    suggestedAward <= remaining
  ) {
    reasons.push(
      `Household income £${application.householdIncome} within auto-approve threshold ` +
        `£${effectiveRules.autoApproveBelowIncome}.`,
    );
    reasons.push(
      `Award £${suggestedAward} (default £${effectiveRules.defaultAwardAmount}, ` +
        `capped at £${effectiveRules.maxAwardPerStudent}) within remaining fund ` +
        `budget £${remaining}.`,
    );
    return {
      decision: 'APPROVE',
      suggestedAward,
      reasons,
      effectiveRules,
    };
  }

  // ── Otherwise REVIEW ────────────────────────────────────────────────────
  if (application.householdIncome == null) {
    reasons.push(
      'Household income not reported; manual review required to assess need.',
    );
  } else {
    reasons.push(
      `Household income £${application.householdIncome} falls between thresholds ` +
        `(£${effectiveRules.autoApproveBelowIncome} … £${effectiveRules.autoRejectAboveIncome}); ` +
        'manual review required.',
    );
  }

  return {
    decision: 'REVIEW',
    suggestedAward,
    reasons,
    effectiveRules,
  };
}
