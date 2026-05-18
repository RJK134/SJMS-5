import { describe, it, expect } from 'vitest';
import {
  decideProgression,
  type ModuleResultForProgression,
  type ProgressionInput,
} from '../../utils/progression-decision';

// ── Phase 17D — pure-function tests for progression decisioning ────────────
//
// These tests exercise the deterministic credit-and-mark rules in
// isolation from any I/O. The default rules capture standard UK HE
// practice (120 credits per year, 40% pass mark, no compensation by
// default); per-call overrides cover institutions that allow
// compensation or have non-standard credit totals.

const m = (overrides: Partial<ModuleResultForProgression> = {}): ModuleResultForProgression => ({
  id: 'mr-x',
  moduleId: 'mod-x',
  credits: 30,
  aggregateMark: 60,
  isPass: true,
  ...overrides,
});

const baseInput = (overrides: Partial<ProgressionInput> = {}): ProgressionInput => ({
  moduleResults: [],
  programmeLevel: 'LEVEL_5',
  yearOfStudy: 2,
  ...overrides,
});

describe('decideProgression()', () => {
  describe('happy paths', () => {
    it('returns PROGRESS when all 120 credits pass', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65 }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 70 }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 55 }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 60 }),
          ],
        }),
      );
      expect(result.decision).toBe('PROGRESS');
      expect(result.totalCreditsAttempted).toBe(120);
      expect(result.totalCreditsPassed).toBe(120);
      expect(result.totalCreditsFailed).toBe(0);
      expect(result.averageMark).toBe(62.5);
      expect(result.failedModuleIds).toEqual([]);
    });

    it('returns AWARD on the final year when full credits pass', () => {
      const result = decideProgression(
        baseInput({
          isFinalYear: true,
          yearOfStudy: 3,
          programmeLevel: 'LEVEL_6',
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 60, aggregateMark: 75 }),
            m({ id: 'b', moduleId: 'b', credits: 60, aggregateMark: 65 }),
          ],
        }),
      );
      expect(result.decision).toBe('AWARD');
      expect(result.reason).toMatch(/Eligible for award/);
    });

    it('credit-weighted average ignores modules with no aggregateMark', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 60 }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: null, isPass: true }),
          ],
        }),
      );
      expect(result.averageMark).toBe(60);
    });

    it('returns null averageMark when no module has an aggregateMark', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: null, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: null, isPass: true }),
          ],
        }),
      );
      expect(result.averageMark).toBeNull();
    });
  });

  describe('failure decisioning', () => {
    it('returns REPEAT_MODULES when 1 module fails (recoverable)', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 55, isPass: true }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 35, isPass: false }),
          ],
        }),
      );
      expect(result.decision).toBe('REPEAT_MODULES');
      expect(result.failedModuleIds).toEqual(['d']);
      expect(result.totalCreditsPassed).toBe(90);
    });

    it('returns REPEAT_YEAR when 3+ modules fail (substantive) but credits-passed are above the WITHDRAW threshold', () => {
      // 4 modules pass (80 credits) and 4 fail (80 credits) — 80/160 = 50%
      // (above the WITHDRAW threshold of 50% for 160 credits attempted) but
      // 4 failures are too many for REPEAT_MODULES (capped at 2), so the
      // canonical decision is REPEAT_YEAR.
      const result = decideProgression(
        baseInput({
          rules: { fullYearCredits: 160 },
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 20, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 20, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 20, aggregateMark: 55, isPass: true }),
            m({ id: 'd', moduleId: 'd', credits: 20, aggregateMark: 50, isPass: true }),
            m({ id: 'e', moduleId: 'e', credits: 20, aggregateMark: 35, isPass: false }),
            m({ id: 'f', moduleId: 'f', credits: 20, aggregateMark: 38, isPass: false }),
            m({ id: 'g', moduleId: 'g', credits: 20, aggregateMark: 36, isPass: false }),
            m({ id: 'h', moduleId: 'h', credits: 20, aggregateMark: 39, isPass: false }),
          ],
        }),
      );
      expect(result.decision).toBe('REPEAT_YEAR');
      expect(result.failedModuleIds).toEqual(['e', 'f', 'g', 'h']);
      expect(result.totalCreditsPassed).toBe(80);
    });

    it('returns WITHDRAW when below the 50% credit threshold', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 20, isPass: false }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 15, isPass: false }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 10, isPass: false }),
          ],
        }),
      );
      expect(result.decision).toBe('WITHDRAW');
      expect(result.totalCreditsPassed).toBe(30);
    });
  });

  describe('compensation rules', () => {
    it('compensates failed credits within the envelope when mark is at or above the floor', () => {
      const result = decideProgression(
        baseInput({
          rules: { maxCompensatedCredits: 30, compensationMinMark: 30 },
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 55, isPass: true }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 38, isPass: false }), // compensable
          ],
        }),
      );
      expect(result.decision).toBe('PROGRESS');
      expect(result.compensatedModuleIds).toEqual(['d']);
      expect(result.reason).toMatch(/30 compensated/);
    });

    it('does NOT compensate failures below compensationMinMark', () => {
      const result = decideProgression(
        baseInput({
          rules: { maxCompensatedCredits: 30, compensationMinMark: 30 },
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 55, isPass: true }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 22, isPass: false }), // below floor
          ],
        }),
      );
      expect(result.decision).toBe('REPEAT_MODULES');
      expect(result.compensatedModuleIds).toEqual([]);
    });

    it('honours maxCompensatedCredits — does not compensate beyond the cap', () => {
      const result = decideProgression(
        baseInput({
          rules: { maxCompensatedCredits: 30, compensationMinMark: 30 },
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 38, isPass: false }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 35, isPass: false }),
          ],
        }),
      );
      // Only 30 credits compensated → 60 + 30 = 90, not enough → REPEAT_MODULES
      expect(result.decision).toBe('REPEAT_MODULES');
      expect(result.compensatedModuleIds.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns REPEAT_YEAR with explicit reason on an empty cohort', () => {
      const result = decideProgression(baseInput({ moduleResults: [] }));
      expect(result.decision).toBe('REPEAT_YEAR');
      expect(result.totalCreditsAttempted).toBe(0);
      expect(result.reason).toMatch(/No credit-bearing/);
    });

    it('skips modules with non-positive credits (defensive)', () => {
      const result = decideProgression(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'broken', moduleId: 'broken', credits: 0, aggregateMark: 50, isPass: true }),
          ],
        }),
      );
      expect(result.totalCreditsAttempted).toBe(30);
    });

    it('captures effective rules in the outcome for audit', () => {
      const result = decideProgression(
        baseInput({
          rules: { fullYearCredits: 90, maxCompensatedCredits: 15 },
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 65, isPass: true }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60, isPass: true }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 55, isPass: true }),
          ],
        }),
      );
      expect(result.effectiveRules.fullYearCredits).toBe(90);
      expect(result.effectiveRules.maxCompensatedCredits).toBe(15);
      expect(result.effectiveRules.compensationMinMark).toBe(30); // default preserved
      expect(result.effectiveRules.withdrawThresholdRatio).toBe(0.5); // default preserved
    });
  });
});
