import { describe, it, expect } from 'vitest';
import {
  calculateFee,
  type FeeCalculationInput,
} from '../../utils/fee-calculation';

// ── Phase 18A — pure-function tests for fee calculation ────────────────────
//
// These cases exercise the canonical UK HE fee rule in isolation from any
// I/O. They are the contract the orchestrating service depends on, so any
// change to the rate tariff or the rule semantics must update both the
// utility and these cases together.
//
// Rule under test:
//   baseFee   = perCreditRate(feeStatus, programmeLevel) × creditsTaken
//   totalFee  = round(baseFee × modeMultiplier, 2)
//   discount  = min(bursaryTotal + sponsorTotal, totalFee × maxDiscountRatio)
//   finalFee  = round(max(0, totalFee − discount), 2)

const baseInput = (
  overrides: Partial<FeeCalculationInput> = {},
): FeeCalculationInput => ({
  programmeLevel: 'LEVEL_4',
  creditsTaken: 120,
  feeStatus: 'HOME',
  modeOfStudy: 'FULL_TIME',
  yearOfStudy: 1,
  ...overrides,
});

describe('calculateFee()', () => {
  describe('default tariff', () => {
    it('returns the canonical UK HE undergraduate full-time fee for HOME × LEVEL_4 × FULL_TIME × 120 credits', () => {
      const out = calculateFee(baseInput());
      expect(out.totalFee).toBe(9240); // 77 × 120 × 1.0
      expect(out.discountAmount).toBe(0);
      expect(out.finalFee).toBe(9240);
      expect(out.breakdown.perCreditRate).toBe(77);
      expect(out.breakdown.modeMultiplier).toBe(1.0);
      expect(out.notes).toEqual([]);
    });

    it('charges OVERSEAS UG higher than HOME UG at the same level', () => {
      const home = calculateFee(baseInput({ feeStatus: 'HOME', programmeLevel: 'LEVEL_6' }));
      const overseas = calculateFee(baseInput({ feeStatus: 'OVERSEAS', programmeLevel: 'LEVEL_6' }));
      expect(overseas.totalFee).toBeGreaterThan(home.totalFee);
      expect(overseas.totalFee).toBe(17520); // 146 × 120
    });

    it('charges PGT higher than UG for the same fee status (HOME L7 vs HOME L6)', () => {
      const ug = calculateFee(baseInput({ feeStatus: 'HOME', programmeLevel: 'LEVEL_6' }));
      const pgt = calculateFee(baseInput({ feeStatus: 'HOME', programmeLevel: 'LEVEL_7' }));
      expect(pgt.totalFee).toBeGreaterThan(ug.totalFee);
      expect(pgt.totalFee).toBe(12960); // 108 × 120
    });

    it('charges PGR (LEVEL_8) at the dedicated tariff', () => {
      const home = calculateFee(baseInput({ feeStatus: 'HOME', programmeLevel: 'LEVEL_8' }));
      expect(home.totalFee).toBe(9000); // 75 × 120
      const overseas = calculateFee(baseInput({ feeStatus: 'OVERSEAS', programmeLevel: 'LEVEL_8' }));
      expect(overseas.totalFee).toBe(21600); // 180 × 120
    });

    it('treats EU_TRANSITIONAL as OVERSEAS for default tariffs', () => {
      const eu = calculateFee(baseInput({ feeStatus: 'EU_TRANSITIONAL', programmeLevel: 'LEVEL_4' }));
      const overseas = calculateFee(baseInput({ feeStatus: 'OVERSEAS', programmeLevel: 'LEVEL_4' }));
      expect(eu.totalFee).toBe(overseas.totalFee);
    });

    it('treats ISLANDS and CHANNEL_ISLANDS as HOME for default tariffs', () => {
      const home = calculateFee(baseInput({ feeStatus: 'HOME' })).totalFee;
      const islands = calculateFee(baseInput({ feeStatus: 'ISLANDS' })).totalFee;
      const channel = calculateFee(baseInput({ feeStatus: 'CHANNEL_ISLANDS' })).totalFee;
      expect(islands).toBe(home);
      expect(channel).toBe(home);
    });
  });

  describe('mode-of-study multipliers', () => {
    it('halves the fee for PART_TIME by default', () => {
      const ft = calculateFee(baseInput({ modeOfStudy: 'FULL_TIME' }));
      const pt = calculateFee(baseInput({ modeOfStudy: 'PART_TIME' }));
      expect(pt.totalFee).toBe(ft.totalFee * 0.5);
      expect(pt.breakdown.modeMultiplier).toBe(0.5);
    });

    it('discounts DISTANCE to 80% by default', () => {
      const ft = calculateFee(baseInput({ modeOfStudy: 'FULL_TIME' }));
      const distance = calculateFee(baseInput({ modeOfStudy: 'DISTANCE' }));
      expect(distance.totalFee).toBe(ft.totalFee * 0.8);
    });

    it('discounts BLOCK_RELEASE to 60% by default', () => {
      const ft = calculateFee(baseInput({ modeOfStudy: 'FULL_TIME' }));
      const br = calculateFee(baseInput({ modeOfStudy: 'BLOCK_RELEASE' }));
      expect(br.totalFee).toBe(ft.totalFee * 0.6);
    });

    it('keeps SANDWICH at full rate by default', () => {
      const ft = calculateFee(baseInput({ modeOfStudy: 'FULL_TIME' }));
      const sw = calculateFee(baseInput({ modeOfStudy: 'SANDWICH' }));
      expect(sw.totalFee).toBe(ft.totalFee);
    });
  });

  describe('credit handling', () => {
    it('scales linearly with creditsTaken', () => {
      const half = calculateFee(baseInput({ creditsTaken: 60 }));
      const full = calculateFee(baseInput({ creditsTaken: 120 }));
      expect(half.totalFee).toBe(full.totalFee / 2);
    });

    it('produces a zero totalFee with a note for non-positive creditsTaken', () => {
      const out = calculateFee(baseInput({ creditsTaken: 0 }));
      expect(out.totalFee).toBe(0);
      expect(out.finalFee).toBe(0);
      expect(out.breakdown.creditsTaken).toBe(0);
      expect(out.notes.some((n) => n.includes('Non-positive creditsTaken'))).toBe(true);
    });

    it('treats a negative creditsTaken as zero rather than negative billing', () => {
      const out = calculateFee(baseInput({ creditsTaken: -30 }));
      expect(out.totalFee).toBe(0);
    });
  });

  describe('bursaries and sponsor contributions', () => {
    it('subtracts the sum of bursaries from totalFee', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [{ amount: 1000, reference: 'b-1' }, { amount: 500 }],
        }),
      );
      expect(out.discountAmount).toBe(1500);
      expect(out.finalFee).toBe(out.totalFee - 1500);
      expect(out.breakdown.bursaryTotal).toBe(1500);
    });

    it('subtracts the sum of sponsor contributions from totalFee', () => {
      const out = calculateFee(
        baseInput({
          sponsorContributions: [{ amount: 2000, reference: 's-1' }],
        }),
      );
      expect(out.discountAmount).toBe(2000);
      expect(out.breakdown.sponsorTotal).toBe(2000);
    });

    it('combines bursary and sponsor totals into a single discountAmount', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [{ amount: 1000 }],
          sponsorContributions: [{ amount: 3000 }],
        }),
      );
      expect(out.discountAmount).toBe(4000);
      expect(out.finalFee).toBe(out.totalFee - 4000);
    });

    it('caps finalFee at zero when discount exceeds totalFee', () => {
      const out = calculateFee(
        baseInput({
          creditsTaken: 60,
          bursaries: [{ amount: 99999 }],
        }),
      );
      expect(out.finalFee).toBe(0);
      // Default cap is 1.0 (full waiver allowed), so discount equals totalFee here.
      expect(out.discountAmount).toBe(out.totalFee);
    });

    it('caps the discount at maxDiscountRatio when set below 1.0', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [{ amount: 99999 }],
          rules: { maxDiscountRatio: 0.5 },
        }),
      );
      expect(out.discountAmount).toBe(out.totalFee * 0.5);
      expect(out.finalFee).toBe(out.totalFee * 0.5);
      expect(out.notes.some((n) => n.includes('Discount capped'))).toBe(true);
    });

    it('skips non-positive and non-finite contribution amounts silently', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [
            { amount: 1000 },
            { amount: 0 },
            { amount: -500 },
            { amount: Number.NaN },
            { amount: Number.POSITIVE_INFINITY },
          ],
        }),
      );
      expect(out.discountAmount).toBe(1000);
    });
  });

  describe('rule overrides', () => {
    it('honours an explicit per-credit rate override', () => {
      const out = calculateFee(
        baseInput({
          rules: {
            perCreditRates: { HOME: { LEVEL_4: 100 } },
          },
        }),
      );
      expect(out.totalFee).toBe(12000); // 100 × 120
      expect(out.effectiveRules.perCreditRate).toBe(100);
    });

    it('honours an explicit mode multiplier override', () => {
      const out = calculateFee(
        baseInput({
          rules: { modeMultipliers: { FULL_TIME: 0.9 } },
        }),
      );
      expect(out.totalFee).toBe(9240 * 0.9);
      expect(out.effectiveRules.modeMultiplier).toBe(0.9);
    });

    it('falls through to default when an override cell is missing', () => {
      const out = calculateFee(
        baseInput({
          programmeLevel: 'LEVEL_5',
          rules: {
            perCreditRates: { HOME: { LEVEL_4: 100 } },
          },
        }),
      );
      expect(out.totalFee).toBe(9240); // L5 still uses default 77
    });

    it('rejects a negative override and falls through to default with no crash', () => {
      const out = calculateFee(
        baseInput({
          rules: {
            perCreditRates: { HOME: { LEVEL_4: -10 } },
          },
        }),
      );
      expect(out.totalFee).toBe(9240); // -10 ignored, default 77 used
    });

    it('clamps maxDiscountRatio outside [0,1] back to default 1.0', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [{ amount: 99999 }],
          rules: { maxDiscountRatio: 1.5 },
        }),
      );
      expect(out.effectiveRules.maxDiscountRatio).toBe(1.0);
    });
  });

  describe('rounding and effective rules', () => {
    it('rounds totalFee and finalFee to 2 decimal places', () => {
      const out = calculateFee(
        baseInput({
          creditsTaken: 90,
          rules: { perCreditRates: { HOME: { LEVEL_4: 77.333 } } },
        }),
      );
      // 77.333 × 90 = 6959.97, exact at 2dp
      expect(out.totalFee).toBe(6959.97);
    });

    it('reports the resolved per-credit rate and mode multiplier in effectiveRules for audit', () => {
      const out = calculateFee(
        baseInput({
          feeStatus: 'OVERSEAS',
          programmeLevel: 'LEVEL_7',
          modeOfStudy: 'PART_TIME',
        }),
      );
      expect(out.effectiveRules).toEqual({
        perCreditRate: 200,
        modeMultiplier: 0.5,
        maxDiscountRatio: 1.0,
      });
    });

    it('preserves bursary and sponsor totals in the breakdown for audit', () => {
      const out = calculateFee(
        baseInput({
          bursaries: [{ amount: 750 }],
          sponsorContributions: [{ amount: 250 }],
        }),
      );
      expect(out.breakdown.bursaryTotal).toBe(750);
      expect(out.breakdown.sponsorTotal).toBe(250);
    });
  });

  describe('determinism', () => {
    it('produces the same output for the same input on repeated calls', () => {
      const input = baseInput({
        bursaries: [{ amount: 1000, reference: 'b-1' }],
        sponsorContributions: [{ amount: 2000, reference: 's-1' }],
      });
      const a = calculateFee(input);
      const b = calculateFee(input);
      expect(a).toEqual(b);
    });
  });
});
