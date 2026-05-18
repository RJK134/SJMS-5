import { describe, it, expect } from 'vitest';
import {
  classifyAward,
  type ModuleResultForClassification,
  type ClassificationInput,
} from '../../utils/award-classification';

// ── Phase 17D — pure-function tests for award classification ──────────────
//
// Standard UK HE classification thresholds:
//   LEVEL_6 (UG honours): >=70 FIRST, >=60 UPPER_SECOND, >=50 LOWER_SECOND,
//                          >=40 THIRD, <40 FAIL
//   LEVEL_7 (PG taught):   >=70 DISTINCTION, >=60 MERIT, >=50 PASS, <50 FAIL
//   LEVEL_3-5:             >=40 PASS, <40 FAIL
//   LEVEL_8 (doctoral):    not classifiable by average — refused

const m = (overrides: Partial<ModuleResultForClassification> = {}): ModuleResultForClassification => ({
  id: 'mr-x',
  moduleId: 'mod-x',
  credits: 20,
  level: 6,
  aggregateMark: 60,
  ...overrides,
});

const baseInput = (overrides: Partial<ClassificationInput> = {}): ClassificationInput => ({
  moduleResults: [],
  programmeLevel: 'LEVEL_6',
  ...overrides,
});

describe('classifyAward()', () => {
  describe('honours degree (LEVEL_6)', () => {
    it.each([
      { mark: 75, expected: 'FIRST' },
      { mark: 70, expected: 'FIRST' },
      { mark: 69.99, expected: 'UPPER_SECOND' },
      { mark: 60, expected: 'UPPER_SECOND' },
      { mark: 59.99, expected: 'LOWER_SECOND' },
      { mark: 50, expected: 'LOWER_SECOND' },
      { mark: 49.99, expected: 'THIRD' },
      { mark: 40, expected: 'THIRD' },
      { mark: 39.99, expected: 'FAIL' },
      { mark: 0, expected: 'FAIL' },
    ])('classifies $mark% as $expected', ({ mark, expected }) => {
      const result = classifyAward(
        baseInput({
          moduleResults: [m({ aggregateMark: mark, credits: 120 })],
        }),
      );
      expect(result.classification).toBe(expected);
    });
  });

  describe('postgraduate taught (LEVEL_7)', () => {
    it.each([
      { mark: 75, expected: 'DISTINCTION' },
      { mark: 65, expected: 'MERIT' },
      { mark: 55, expected: 'PASS' },
      { mark: 45, expected: 'FAIL' },
    ])('classifies $mark% as $expected', ({ mark, expected }) => {
      const result = classifyAward(
        baseInput({
          programmeLevel: 'LEVEL_7',
          moduleResults: [m({ aggregateMark: mark, credits: 180 })],
        }),
      );
      expect(result.classification).toBe(expected);
    });
  });

  describe('sub-honours (LEVEL_3 to LEVEL_5)', () => {
    it('returns PASS when average is at or above 40%', () => {
      const result = classifyAward(
        baseInput({
          programmeLevel: 'LEVEL_4',
          moduleResults: [m({ aggregateMark: 55, credits: 120 })],
        }),
      );
      expect(result.classification).toBe('PASS');
    });

    it('returns FAIL when average is below 40%', () => {
      const result = classifyAward(
        baseInput({
          programmeLevel: 'LEVEL_4',
          moduleResults: [m({ aggregateMark: 35, credits: 120 })],
        }),
      );
      expect(result.classification).toBe('FAIL');
    });
  });

  describe('credit weighting', () => {
    it('weights modules by credit value when no explicit weight is supplied', () => {
      // 70 * 60 + 50 * 60 = 7200; total 120 credits → 60.0
      const result = classifyAward(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 60, aggregateMark: 70 }),
            m({ id: 'b', moduleId: 'b', credits: 60, aggregateMark: 50 }),
          ],
        }),
      );
      expect(result.finalAverage).toBe(60);
      expect(result.classification).toBe('UPPER_SECOND');
    });

    it('respects explicit per-module weights when supplied (final-year uplift)', () => {
      // Penultimate year: 50% with weight 1, final year: 80% with weight 2.
      // Weighted average = (50*1 + 80*2) / 3 = 210/3 = 70 → FIRST
      const result = classifyAward(
        baseInput({
          moduleResults: [
            m({ id: 'penult', moduleId: 'penult', credits: 30, aggregateMark: 50, weight: 1 }),
            m({ id: 'final', moduleId: 'final', credits: 30, aggregateMark: 80, weight: 2 }),
          ],
        }),
      );
      expect(result.finalAverage).toBe(70);
      expect(result.classification).toBe('FIRST');
    });
  });

  describe('missing data', () => {
    it('excludes modules without an aggregateMark from the average', () => {
      const result = classifyAward(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', aggregateMark: 70, credits: 60 }),
            m({ id: 'missing', moduleId: 'missing', aggregateMark: null, credits: 60 }),
          ],
        }),
      );
      expect(result.finalAverage).toBe(70);
      expect(result.contributingModuleCount).toBe(1);
      expect(result.excludedModuleIds).toEqual(['missing']);
    });

    it('returns FAIL with explicit reason when no module contributes a mark', () => {
      const result = classifyAward(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', aggregateMark: null, credits: 60 }),
          ],
        }),
      );
      expect(result.classification).toBe('FAIL');
      expect(result.finalAverage).toBeNull();
      expect(result.reason).toMatch(/No module results with a recorded aggregateMark/);
    });
  });

  describe('LEVEL_8 (doctoral)', () => {
    it('refuses to classify and returns FAIL with an explicit reason', () => {
      const result = classifyAward(
        baseInput({
          programmeLevel: 'LEVEL_8',
          moduleResults: [m({ id: 'a', moduleId: 'a', aggregateMark: 80, credits: 360 })],
        }),
      );
      expect(result.classification).toBe('FAIL');
      expect(result.reason).toMatch(/doctoral/i);
      expect(result.reason).toMatch(/manual classification/i);
    });
  });

  describe('rounding', () => {
    it('rounds the final average to two decimal places', () => {
      // 70 * 30 + 60 * 30 + 50 * 30 = 5400; total 90 credits = 60
      // Add a 4th module: 70 * 30 + 60 * 30 + 50 * 30 + 33.5 * 30 = 6405; 120 = 53.375 → 53.38
      const result = classifyAward(
        baseInput({
          moduleResults: [
            m({ id: 'a', moduleId: 'a', credits: 30, aggregateMark: 70 }),
            m({ id: 'b', moduleId: 'b', credits: 30, aggregateMark: 60 }),
            m({ id: 'c', moduleId: 'c', credits: 30, aggregateMark: 50 }),
            m({ id: 'd', moduleId: 'd', credits: 30, aggregateMark: 33.5 }),
          ],
        }),
      );
      expect(result.finalAverage).toBe(53.38);
    });
  });

  describe('rule overrides', () => {
    it('respects custom honours boundaries', () => {
      const result = classifyAward(
        baseInput({
          rules: {
            honoursBoundaries: [
              { minAverageMark: 80, classification: 'FIRST' },
              { minAverageMark: 65, classification: 'UPPER_SECOND' },
              { minAverageMark: 50, classification: 'LOWER_SECOND' },
            ],
          },
          moduleResults: [m({ aggregateMark: 75, credits: 120 })],
        }),
      );
      // Default would be FIRST (>=70); with the override only >=80 is FIRST.
      expect(result.classification).toBe('UPPER_SECOND');
    });
  });
});
