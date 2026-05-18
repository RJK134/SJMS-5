import { describe, it, expect } from 'vitest';
import { aggregateMarks, type AttemptForAggregation } from '../../utils/marks-aggregation';

// ── Phase 17A — pure-function tests for marks aggregation ──────────────────
//
// These tests exercise the deterministic weighted-average rule in isolation
// from any I/O. They are the contract the orchestrating service depends on,
// so any change to the aggregation maths must update both the rule and
// these cases together.
//
// Algorithm under test:
//   percentage_i  = (finalMark_i / maxMark_i) * 100
//   contribution  = percentage_i * (weighting_i / sum(weightings))
//   aggregate     = round(sum(contribution_i), 2)

const a = (overrides: Partial<AttemptForAggregation> = {}): AttemptForAggregation => ({
  assessmentId: 'assess-x',
  finalMark: 50,
  maxMark: 100,
  weighting: 50,
  ...overrides,
});

describe('aggregateMarks()', () => {
  describe('happy paths', () => {
    it('returns null aggregate and isComplete=false for an empty input', () => {
      const result = aggregateMarks([]);
      expect(result).toEqual({
        aggregatePercentage: null,
        totalWeighting: 0,
        componentCount: 0,
        contributingCount: 0,
        isComplete: false,
        missingAssessmentIds: [],
      });
    });

    it('computes a simple weighted average across two equally-weighted attempts', () => {
      const result = aggregateMarks([
        a({ assessmentId: 'a-1', finalMark: 60, maxMark: 100, weighting: 50 }),
        a({ assessmentId: 'a-2', finalMark: 80, maxMark: 100, weighting: 50 }),
      ]);
      expect(result.aggregatePercentage).toBe(70);
      expect(result.totalWeighting).toBe(100);
      expect(result.componentCount).toBe(2);
      expect(result.contributingCount).toBe(2);
      expect(result.isComplete).toBe(true);
      expect(result.missingAssessmentIds).toEqual([]);
    });

    it('respects asymmetric weightings', () => {
      // 100 * 0.7 + 0 * 0.3 = 70
      const result = aggregateMarks([
        a({ assessmentId: 'big', finalMark: 100, maxMark: 100, weighting: 70 }),
        a({ assessmentId: 'small', finalMark: 0, maxMark: 100, weighting: 30 }),
      ]);
      expect(result.aggregatePercentage).toBe(70);
      expect(result.totalWeighting).toBe(100);
    });

    it('normalises by the actual sum of contributing weightings, not 100', () => {
      // Weightings of 30 + 30 = 60; both attempts at 50%. Aggregate is 50.
      const result = aggregateMarks([
        a({ assessmentId: 'a-1', finalMark: 50, maxMark: 100, weighting: 30 }),
        a({ assessmentId: 'a-2', finalMark: 50, maxMark: 100, weighting: 30 }),
      ]);
      expect(result.aggregatePercentage).toBe(50);
      expect(result.totalWeighting).toBe(60);
      // Caller is responsible for spotting the 60 != 100 case — the
      // utility itself returns a faithful average over the weights present.
    });

    it('handles non-uniform maxMark scaling correctly', () => {
      // 25/50 = 50% at weight 60, 80/100 = 80% at weight 40
      // 50 * 0.6 + 80 * 0.4 = 30 + 32 = 62
      const result = aggregateMarks([
        a({ assessmentId: 'half-scale', finalMark: 25, maxMark: 50, weighting: 60 }),
        a({ assessmentId: 'full-scale', finalMark: 80, maxMark: 100, weighting: 40 }),
      ]);
      expect(result.aggregatePercentage).toBe(62);
    });
  });

  describe('rounding', () => {
    it('rounds the final aggregate to two decimal places', () => {
      // 33.333... weighted equally with 33.333... => 33.333... → 33.33
      const result = aggregateMarks([
        a({ assessmentId: 'a-1', finalMark: 1, maxMark: 3, weighting: 50 }),
        a({ assessmentId: 'a-2', finalMark: 1, maxMark: 3, weighting: 50 }),
      ]);
      expect(result.aggregatePercentage).toBe(33.33);
    });

    it('rounds 49.995 up to 50.00 (banker-free, simple half-up)', () => {
      // 49 of 100 at weight 50, 50.99 of 100 at weight 50
      // (49 + 50.99) / 2 = 49.995 → 50.00 with Math.round
      const result = aggregateMarks([
        a({ assessmentId: 'a-1', finalMark: 49, maxMark: 100, weighting: 50 }),
        a({ assessmentId: 'a-2', finalMark: 50.99, maxMark: 100, weighting: 50 }),
      ]);
      expect(result.aggregatePercentage).toBe(50);
    });
  });

  describe('missing components', () => {
    it('reports a missing finalMark and treats it as non-contributing (no silent zero)', () => {
      // Only the second attempt contributes — aggregate is 80%, not 40%.
      const result = aggregateMarks([
        a({ assessmentId: 'missing', finalMark: null, maxMark: 100, weighting: 50 }),
        a({ assessmentId: 'present', finalMark: 80, maxMark: 100, weighting: 50 }),
      ]);
      expect(result.aggregatePercentage).toBe(80);
      expect(result.contributingCount).toBe(1);
      expect(result.componentCount).toBe(2);
      expect(result.totalWeighting).toBe(50);
      expect(result.isComplete).toBe(false);
      expect(result.missingAssessmentIds).toEqual(['missing']);
    });

    it('returns a null aggregate when every attempt is missing', () => {
      const result = aggregateMarks([
        a({ assessmentId: 'm-1', finalMark: null }),
        a({ assessmentId: 'm-2', finalMark: null }),
      ]);
      expect(result.aggregatePercentage).toBe(null);
      expect(result.totalWeighting).toBe(0);
      expect(result.contributingCount).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(result.missingAssessmentIds).toEqual(['m-1', 'm-2']);
    });
  });

  describe('defensive guards', () => {
    it('skips attempts with non-positive maxMark to avoid divide-by-zero', () => {
      const result = aggregateMarks([
        a({ assessmentId: 'broken', finalMark: 5, maxMark: 0, weighting: 50 }),
        a({ assessmentId: 'good', finalMark: 60, maxMark: 100, weighting: 50 }),
      ]);
      // Only the good attempt contributes; aggregate is 60%.
      expect(result.aggregatePercentage).toBe(60);
      expect(result.contributingCount).toBe(1);
      expect(result.totalWeighting).toBe(50);
    });

    it('skips attempts with non-positive weighting', () => {
      const result = aggregateMarks([
        a({ assessmentId: 'no-weight', finalMark: 100, maxMark: 100, weighting: 0 }),
        a({ assessmentId: 'good', finalMark: 50, maxMark: 100, weighting: 100 }),
      ]);
      expect(result.aggregatePercentage).toBe(50);
      expect(result.totalWeighting).toBe(100);
      expect(result.contributingCount).toBe(1);
    });

    it('keeps isComplete=true when only zero-mark contributors are present', () => {
      // Failing every component is still a complete aggregation (0%).
      const result = aggregateMarks([
        a({ assessmentId: 'zero-1', finalMark: 0, maxMark: 100, weighting: 50 }),
        a({ assessmentId: 'zero-2', finalMark: 0, maxMark: 100, weighting: 50 }),
      ]);
      expect(result.aggregatePercentage).toBe(0);
      expect(result.isComplete).toBe(true);
      expect(result.missingAssessmentIds).toEqual([]);
    });
  });
});
