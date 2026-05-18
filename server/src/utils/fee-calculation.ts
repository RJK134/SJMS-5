/**
 * Phase 18A — Fee calculation engine.
 *
 * Pure, side-effect-free utility implementing the canonical UK HE fee
 * rule used by SJMS 2.5:
 *
 *     baseFee   = perCreditRate(feeStatus, programmeLevel) × creditsTaken
 *     totalFee  = baseFee × modeMultiplier(modeOfStudy)
 *     discount  = sum(bursaries) + sum(sponsorContributions)
 *                 (capped at maxDiscountRatio × totalFee)
 *     finalFee  = max(0, totalFee − discount)
 *
 * The defaults reflect a typical 2025/26 institution-level tariff. They
 * are applied per (feeStatus × programmeLevel) cell and per modeOfStudy,
 * but every cell is overridable through the optional `rules` argument so
 * an institution can configure its own tariff without a code change.
 * Wiring DB-backed rules (SystemSetting / future FeeBand) onto these
 * overrides is a downstream batch.
 *
 * No Prisma, no I/O, no logging, no environmental coupling. Same purity
 * contract as `aggregateMarks` (Phase 17A), `decideProgression` /
 * `classifyAward` (17D), and `composeTranscript` (17E).
 */

export type ProgrammeLevel =
  | 'LEVEL_3'
  | 'LEVEL_4'
  | 'LEVEL_5'
  | 'LEVEL_6'
  | 'LEVEL_7'
  | 'LEVEL_8';

export type FeeStatus =
  | 'HOME'
  | 'OVERSEAS'
  | 'EU_TRANSITIONAL'
  | 'ISLANDS'
  | 'CHANNEL_ISLANDS';

export type ModeOfStudy =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'SANDWICH'
  | 'DISTANCE'
  | 'BLOCK_RELEASE';

/** A single bursary award or sponsor contribution applied to the fee. */
export interface FeeCalculationContribution {
  /** Amount in £. Non-positive or non-finite values are silently skipped. */
  amount: number;
  /** Optional source reference (BursaryApplication id, SponsorAgreement id, etc). Preserved in audit. */
  reference?: string;
}

/** Optional rule overrides forwarded to the calculator. */
export interface FeeCalculationRules {
  /**
   * Per-credit rate overrides keyed by feeStatus then programmeLevel.
   * A missing entry falls back to the default tariff for that cell.
   */
  perCreditRates?: Partial<Record<FeeStatus, Partial<Record<ProgrammeLevel, number>>>>;
  /** Mode-of-study multipliers applied to the base fee. */
  modeMultipliers?: Partial<Record<ModeOfStudy, number>>;
  /** Cap discount as a fraction of total fee (0.0–1.0). Defaults to 1.0 (full waiver allowed). */
  maxDiscountRatio?: number;
}

/** Resolved rule values used by the calculation, surfaced for audit. */
export interface ResolvedFeeRules {
  perCreditRate: number;
  modeMultiplier: number;
  maxDiscountRatio: number;
}

export interface FeeCalculationInput {
  programmeLevel: ProgrammeLevel;
  /** Credits the student is registered for in this assessment window. */
  creditsTaken: number;
  feeStatus: FeeStatus;
  modeOfStudy: ModeOfStudy;
  yearOfStudy: number;
  bursaries?: FeeCalculationContribution[];
  sponsorContributions?: FeeCalculationContribution[];
  rules?: FeeCalculationRules;
}

export interface FeeCalculationBreakdown {
  perCreditRate: number;
  creditsTaken: number;
  baseFee: number;
  modeMultiplier: number;
  bursaryTotal: number;
  sponsorTotal: number;
}

export interface FeeCalculationOutcome {
  /** Pre-discount fee, rounded to 2 dp. */
  totalFee: number;
  /** Sum of applied bursary + sponsor contributions, after capping. */
  discountAmount: number;
  /** max(0, totalFee − discountAmount), rounded to 2 dp. */
  finalFee: number;
  breakdown: FeeCalculationBreakdown;
  effectiveRules: ResolvedFeeRules;
  /** Diagnostic notes (rate fallbacks, discount cap hits, zero-credit warnings). */
  notes: string[];
}

// ── Default tariff (2025/26 typical-institution figures) ─────────────────────
//
// HOME UG  ≈ £9,250 / 120 credits = £77.08 → rounded to £77/credit
// HOME PGT ≈ £12,960 / 120         = £108/credit
// HOME PGR ≈ £9,000 / 120          = £75/credit
// OVERSEAS UG  ≈ £17,520 / 120      = £146/credit
// OVERSEAS PGT ≈ £24,000 / 120      = £200/credit
// OVERSEAS PGR ≈ £21,600 / 120      = £180/credit
// EU_TRANSITIONAL → OVERSEAS rates (post-Brexit policy default)
// ISLANDS / CHANNEL_ISLANDS → HOME rates (Crown Dependencies)

const DEFAULT_PER_CREDIT_RATES: Record<FeeStatus, Record<ProgrammeLevel, number>> = {
  HOME:            { LEVEL_3: 77,  LEVEL_4: 77,  LEVEL_5: 77,  LEVEL_6: 77,  LEVEL_7: 108, LEVEL_8: 75  },
  OVERSEAS:        { LEVEL_3: 146, LEVEL_4: 146, LEVEL_5: 146, LEVEL_6: 146, LEVEL_7: 200, LEVEL_8: 180 },
  EU_TRANSITIONAL: { LEVEL_3: 146, LEVEL_4: 146, LEVEL_5: 146, LEVEL_6: 146, LEVEL_7: 200, LEVEL_8: 180 },
  ISLANDS:         { LEVEL_3: 77,  LEVEL_4: 77,  LEVEL_5: 77,  LEVEL_6: 77,  LEVEL_7: 108, LEVEL_8: 75  },
  CHANNEL_ISLANDS: { LEVEL_3: 77,  LEVEL_4: 77,  LEVEL_5: 77,  LEVEL_6: 77,  LEVEL_7: 108, LEVEL_8: 75  },
};

const DEFAULT_MODE_MULTIPLIERS: Record<ModeOfStudy, number> = {
  FULL_TIME:     1.0,
  PART_TIME:     0.5,
  SANDWICH:      1.0,
  DISTANCE:      0.8,
  BLOCK_RELEASE: 0.6,
};

const DEFAULT_MAX_DISCOUNT_RATIO = 1.0;

function roundToPenny(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function sumContributions(contribs: FeeCalculationContribution[] | undefined): number {
  if (!contribs || contribs.length === 0) return 0;
  let total = 0;
  for (const c of contribs) {
    const amount = typeof c?.amount === 'number' ? c.amount : 0;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
  }
  return total;
}

function resolvePerCreditRate(
  feeStatus: FeeStatus,
  programmeLevel: ProgrammeLevel,
  overrides: FeeCalculationRules['perCreditRates'] | undefined,
  notes: string[],
): number {
  const overrideValue = overrides?.[feeStatus]?.[programmeLevel];
  if (typeof overrideValue === 'number' && Number.isFinite(overrideValue) && overrideValue >= 0) {
    return overrideValue;
  }
  const tariff = DEFAULT_PER_CREDIT_RATES[feeStatus];
  if (tariff && typeof tariff[programmeLevel] === 'number') {
    return tariff[programmeLevel];
  }
  notes.push(
    `No per-credit rate configured for ${feeStatus} × ${programmeLevel}; falling back to HOME × LEVEL_4 default.`,
  );
  return DEFAULT_PER_CREDIT_RATES.HOME.LEVEL_4;
}

function resolveModeMultiplier(
  modeOfStudy: ModeOfStudy,
  overrides: FeeCalculationRules['modeMultipliers'] | undefined,
): number {
  const overrideValue = overrides?.[modeOfStudy];
  if (typeof overrideValue === 'number' && Number.isFinite(overrideValue) && overrideValue >= 0) {
    return overrideValue;
  }
  const dflt = DEFAULT_MODE_MULTIPLIERS[modeOfStudy];
  return typeof dflt === 'number' ? dflt : 1.0;
}

function resolveMaxDiscountRatio(value: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  return DEFAULT_MAX_DISCOUNT_RATIO;
}

/**
 * Calculate a fee from the given input. Pure: same inputs always
 * produce the same outputs, no side effects, no I/O.
 */
export function calculateFee(input: FeeCalculationInput): FeeCalculationOutcome {
  const notes: string[] = [];

  const perCreditRate = resolvePerCreditRate(
    input.feeStatus,
    input.programmeLevel,
    input.rules?.perCreditRates,
    notes,
  );
  const modeMultiplier = resolveModeMultiplier(input.modeOfStudy, input.rules?.modeMultipliers);
  const maxDiscountRatio = resolveMaxDiscountRatio(input.rules?.maxDiscountRatio);

  const credits =
    typeof input.creditsTaken === 'number' &&
    Number.isFinite(input.creditsTaken) &&
    input.creditsTaken > 0
      ? input.creditsTaken
      : 0;
  if (credits === 0) {
    notes.push('Non-positive creditsTaken — totalFee will be zero.');
  }

  const baseFee = perCreditRate * credits;
  const totalFee = roundToPenny(baseFee * modeMultiplier);

  const bursaryTotal = roundToPenny(sumContributions(input.bursaries));
  const sponsorTotal = roundToPenny(sumContributions(input.sponsorContributions));
  const rawDiscount = roundToPenny(bursaryTotal + sponsorTotal);
  const cap = roundToPenny(totalFee * maxDiscountRatio);
  const discountAmount = roundToPenny(Math.min(rawDiscount, cap));
  if (rawDiscount > cap) {
    notes.push(
      `Discount capped at ${Math.round(maxDiscountRatio * 100)}% of total fee (raw £${rawDiscount.toFixed(2)}, cap £${cap.toFixed(2)}).`,
    );
  }
  const finalFee = roundToPenny(Math.max(0, totalFee - discountAmount));

  return {
    totalFee,
    discountAmount,
    finalFee,
    breakdown: {
      perCreditRate,
      creditsTaken: credits,
      baseFee: roundToPenny(baseFee),
      modeMultiplier,
      bursaryTotal,
      sponsorTotal,
    },
    effectiveRules: { perCreditRate, modeMultiplier, maxDiscountRatio },
    notes,
  };
}
