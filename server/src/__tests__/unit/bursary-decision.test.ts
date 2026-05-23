import { describe, it, expect } from 'vitest';
import {
  evaluateBursaryEligibility,
  type BursaryApplicationSnapshot,
  type BursaryFundSnapshot,
} from '../../utils/bursary-decision';

function app(
  overrides: Partial<BursaryApplicationSnapshot> = {},
): BursaryApplicationSnapshot {
  return {
    id: 'app-1',
    status: 'SUBMITTED',
    householdIncome: 20000,
    circumstancesDesc: 'Single parent, two dependants.',
    feeStatus: 'HOME',
    ...overrides,
  };
}

function fund(
  overrides: Partial<BursaryFundSnapshot> = {},
): BursaryFundSnapshot {
  return {
    id: 'fund-1',
    fundType: 'BURSARY',
    remaining: 5000,
    eligibility: null,
    ...overrides,
  };
}

describe('utils/bursary-decision — evaluateBursaryEligibility', () => {
  describe('defaults', () => {
    it('approves a low-income application against default rules', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 12000 }),
        fund({ remaining: 5000 }),
      );
      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(1000); // default
      expect(result.reasons.some((r) => r.includes('auto-approve threshold'))).toBe(true);
    });

    it('rejects a high-income application against default rules', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 80000 }),
        fund({ remaining: 5000 }),
      );
      expect(result.decision).toBe('REJECT');
      expect(result.suggestedAward).toBe(0);
      expect(result.reasons.some((r) => r.includes('exceeds auto-reject threshold'))).toBe(true);
    });

    it('refers a mid-income application to manual review', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 35000 }),
        fund({ remaining: 5000 }),
      );
      expect(result.decision).toBe('REVIEW');
      expect(result.suggestedAward).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('falls between thresholds'))).toBe(true);
    });

    it('refers a no-income application to manual review with a clear reason', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: null }),
        fund({ remaining: 5000 }),
      );
      expect(result.decision).toBe('REVIEW');
      expect(result.reasons.some((r) => r.includes('not reported'))).toBe(true);
    });
  });

  describe('rule overrides', () => {
    it('caps the suggested award at maxAwardPerStudent', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000 }),
        fund({
          remaining: 5000,
          eligibility: { defaultAwardAmount: 4000, maxAwardPerStudent: 1500 },
        }),
      );
      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(1500);
    });

    it('caps the suggested award at the fund remaining when budget is the binding limit', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000 }),
        fund({
          remaining: 250,
          eligibility: { defaultAwardAmount: 1000, maxAwardPerStudent: 1000 },
        }),
      );
      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(250);
    });

    it('rejects when the fund has no remaining budget but the default award is positive', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000 }),
        fund({ remaining: 0 }),
      );
      expect(result.decision).toBe('REJECT');
      expect(result.reasons.some((r) => r.includes('no remaining budget'))).toBe(true);
    });

    it('rejects when the rule requires circumstancesDesc and the application has none', () => {
      const result = evaluateBursaryEligibility(
        app({ circumstancesDesc: null, householdIncome: 12000 }),
        fund({ eligibility: { requiresCircumstancesDesc: true } }),
      );
      expect(result.decision).toBe('REJECT');
      expect(result.reasons[0]).toContain('circumstances description');
    });

    it('rejects an empty (whitespace-only) circumstancesDesc when required', () => {
      const result = evaluateBursaryEligibility(
        app({ circumstancesDesc: '   ', householdIncome: 12000 }),
        fund({ eligibility: { requiresCircumstancesDesc: true } }),
      );
      expect(result.decision).toBe('REJECT');
    });

    it('rejects when feeStatus is not in the allow-list', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000, feeStatus: 'OVERSEAS' }),
        fund({ eligibility: { feeStatusAllowList: ['HOME', 'ISLANDS'] } }),
      );
      expect(result.decision).toBe('REJECT');
      expect(result.reasons[0]).toContain('allow-list');
    });

    it('honours per-call autoRejectAboveIncome and autoApproveBelowIncome overrides', () => {
      const reject = evaluateBursaryEligibility(
        app({ householdIncome: 30000 }),
        fund({ eligibility: { autoRejectAboveIncome: 25000 } }),
      );
      expect(reject.decision).toBe('REJECT');

      const approve = evaluateBursaryEligibility(
        app({ householdIncome: 30000 }),
        fund({
          eligibility: { autoApproveBelowIncome: 40000, autoRejectAboveIncome: 80000 },
        }),
      );
      expect(approve.decision).toBe('APPROVE');
    });

    it('ignores negative rule values and falls back to defaults', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 12000 }),
        fund({
          eligibility: {
            autoApproveBelowIncome: -1,
            defaultAwardAmount: -100,
          } as never,
        }),
      );
      // Defaults restored → 12000 ≤ 15000 ✓, default award 1000.
      expect(result.decision).toBe('APPROVE');
      expect(result.suggestedAward).toBe(1000);
    });
  });

  describe('audit + traceability', () => {
    it('captures effectiveRules on every decision (audit trail)', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000 }),
        fund({
          eligibility: { autoApproveBelowIncome: 18000, defaultAwardAmount: 750 },
        }),
      );
      expect(result.effectiveRules.autoApproveBelowIncome).toBe(18000);
      expect(result.effectiveRules.defaultAwardAmount).toBe(750);
      // Defaults are present for unspecified fields
      expect(result.effectiveRules.autoRejectAboveIncome).toBe(60000);
    });

    it('rounds the suggested award to 2 decimal places', () => {
      const result = evaluateBursaryEligibility(
        app({ householdIncome: 10000 }),
        fund({
          remaining: 999.999,
          eligibility: { defaultAwardAmount: 1000, maxAwardPerStudent: 1000 },
        }),
      );
      expect(result.suggestedAward).toBe(1000);
      // remaining rounds to 1000.00, so award = min(1000, 1000, 1000) = 1000
    });

    it('is deterministic for the same inputs', () => {
      const a = evaluateBursaryEligibility(app(), fund());
      const b = evaluateBursaryEligibility(app(), fund());
      expect(a).toEqual(b);
    });
  });
});
