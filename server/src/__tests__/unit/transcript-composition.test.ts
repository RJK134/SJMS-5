import { describe, it, expect } from 'vitest';
import {
  composeTranscript,
  type ModuleResultForTranscript,
  type ComposeTranscriptInput,
  type AwardForTranscript,
} from '../../utils/transcript-composition';

// ── Phase 17E — pure-function tests for transcript composition ──────────────
//
// Layout / formatting rules in isolation from any I/O. The composer
// should: order rows by year (descending) then module code (ascending);
// produce per-year averages from rows that have a mark; refuse to mark a
// FINAL transcript as final without a non-revoked AwardRecord.

const fakeStudent = {
  id: 'stu-1',
  studentNumber: 'STU-2025-00001',
  fullName: 'Ada Lovelace',
  dateOfBirth: '1815-12-10',
};

const fakeProgramme = {
  id: 'prog-1',
  programmeCode: 'BSC-CS-001',
  title: 'BSc (Hons) Computer Science',
  level: 'LEVEL_6',
  awardingBody: 'Future Horizons Education',
};

const m = (overrides: Partial<ModuleResultForTranscript> = {}): ModuleResultForTranscript => ({
  id: 'mr-x',
  moduleId: 'mod-x',
  moduleCode: 'CS101',
  moduleTitle: 'Foundations of Computing',
  credits: 30,
  aggregateMark: 65,
  grade: 'B',
  academicYear: '2025/26',
  status: 'CONFIRMED',
  ...overrides,
});

const baseInput = (overrides: Partial<ComposeTranscriptInput> = {}): ComposeTranscriptInput => ({
  student: fakeStudent,
  programme: fakeProgramme,
  moduleResults: [],
  award: null,
  transcriptType: 'INTERIM',
  generatedDate: new Date('2026-04-30T10:00:00Z'),
  generatedBy: 'user-1',
  ...overrides,
});

describe('composeTranscript()', () => {
  describe('header', () => {
    it('populates the student / programme / generation fields verbatim', () => {
      const out = composeTranscript(baseInput());
      expect(out.header).toEqual(
        expect.objectContaining({
          studentNumber: 'STU-2025-00001',
          studentName: 'Ada Lovelace',
          dateOfBirth: '1815-12-10',
          programmeCode: 'BSC-CS-001',
          programmeTitle: 'BSc (Hons) Computer Science',
          programmeLevel: 'LEVEL_6',
          awardingBody: 'Future Horizons Education',
          transcriptType: 'INTERIM',
          generatedBy: 'user-1',
        }),
      );
    });
  });

  describe('lines', () => {
    it('orders by academic year descending, then module code ascending', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'CS401', academicYear: '2024/25' }),
            m({ moduleCode: 'CS601', academicYear: '2026/27' }),
            m({ moduleCode: 'CS501', academicYear: '2025/26' }),
            m({ moduleCode: 'CS502', academicYear: '2025/26' }),
          ],
        }),
      );
      expect(out.lines.map((l) => `${l.academicYear}:${l.moduleCode}`)).toEqual([
        '2026/27:CS601',
        '2025/26:CS501',
        '2025/26:CS502',
        '2024/25:CS401',
      ]);
      // sortOrder is the index in the canonical order
      expect(out.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3]);
    });

    it('skips modules with non-positive credits and notes the skip', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'CS101', credits: 30 }),
            m({ moduleCode: 'BROKEN', credits: 0 }),
          ],
        }),
      );
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0].moduleCode).toBe('CS101');
      expect(out.notes.some((n) => n.includes('BROKEN'))).toBe(true);
    });
  });

  describe('totals and per-year summaries', () => {
    it('credit-weights the final average across rows that have a mark', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'A', credits: 60, aggregateMark: 70, academicYear: '2025/26' }),
            m({ moduleCode: 'B', credits: 60, aggregateMark: 50, academicYear: '2025/26' }),
          ],
        }),
      );
      expect(out.totals.finalAverage).toBe(60);
      expect(out.totals.totalCredits).toBe(120);
      expect(out.totals.contributingLineCount).toBe(2);
    });

    it('excludes rows without a mark from the average but counts their credits', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'A', credits: 60, aggregateMark: 70 }),
            m({ moduleCode: 'B', credits: 60, aggregateMark: null, grade: null }),
          ],
        }),
      );
      expect(out.totals.finalAverage).toBe(70);
      expect(out.totals.contributingLineCount).toBe(1);
      expect(out.totals.totalCredits).toBe(120);
    });

    it('emits a per-year summary for each distinct academic year, descending', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'L4-A', credits: 30, aggregateMark: 60, academicYear: '2024/25' }),
            m({ moduleCode: 'L4-B', credits: 30, aggregateMark: 70, academicYear: '2024/25' }),
            m({ moduleCode: 'L5-A', credits: 30, aggregateMark: 65, academicYear: '2025/26' }),
            m({ moduleCode: 'L5-B', credits: 30, aggregateMark: 75, academicYear: '2025/26' }),
          ],
        }),
      );
      expect(out.yearSummaries).toHaveLength(2);
      expect(out.yearSummaries[0].academicYear).toBe('2025/26');
      expect(out.yearSummaries[0].averageMark).toBe(70);
      expect(out.yearSummaries[1].academicYear).toBe('2024/25');
      expect(out.yearSummaries[1].averageMark).toBe(65);
    });

    it('rounds the final average to two decimal places', () => {
      const out = composeTranscript(
        baseInput({
          moduleResults: [
            m({ moduleCode: 'A', credits: 30, aggregateMark: 70 }),
            m({ moduleCode: 'B', credits: 30, aggregateMark: 60 }),
            m({ moduleCode: 'C', credits: 30, aggregateMark: 50 }),
            m({ moduleCode: 'D', credits: 30, aggregateMark: 33.5 }),
          ],
        }),
      );
      expect(out.totals.finalAverage).toBe(53.38);
    });
  });

  describe('award block and FINAL precondition', () => {
    const award: AwardForTranscript = {
      id: 'aw-1',
      awardTitle: 'BSc (Hons) Computer Science',
      classification: 'UPPER_SECOND',
      finalAverage: 67.5,
      awardDate: '2026-07-12',
      status: 'RECOMMENDED',
    };

    it('mirrors the award block onto the output when supplied', () => {
      const out = composeTranscript(
        baseInput({
          transcriptType: 'FINAL',
          award,
          moduleResults: [m({ moduleCode: 'A', credits: 120, aggregateMark: 67.5 })],
        }),
      );
      expect(out.award).toEqual(
        expect.objectContaining({
          title: 'BSc (Hons) Computer Science',
          classification: 'UPPER_SECOND',
          finalAverage: 67.5,
          status: 'RECOMMENDED',
        }),
      );
      expect(out.isFinal).toBe(true);
    });

    it('flags FINAL as not-final when no AwardRecord is supplied (with a note)', () => {
      const out = composeTranscript(
        baseInput({
          transcriptType: 'FINAL',
          award: null,
          moduleResults: [m({ moduleCode: 'A', credits: 120, aggregateMark: 67.5 })],
        }),
      );
      expect(out.isFinal).toBe(false);
      expect(out.notes.some((n) => n.includes('no AwardRecord'))).toBe(true);
    });

    it('flags FINAL as not-final when the AwardRecord is REVOKED', () => {
      const out = composeTranscript(
        baseInput({
          transcriptType: 'FINAL',
          award: { ...award, status: 'REVOKED' },
          moduleResults: [m({ moduleCode: 'A', credits: 120, aggregateMark: 67.5 })],
        }),
      );
      expect(out.isFinal).toBe(false);
      expect(out.notes.some((n) => n.includes('REVOKED'))).toBe(true);
    });

    it('returns null award block on INTERIM transcripts', () => {
      const out = composeTranscript(baseInput({ award: null, transcriptType: 'INTERIM' }));
      expect(out.award).toBeNull();
      // INTERIM is always "isFinal: true" in the sense that it doesn't fail the FINAL precondition.
      expect(out.isFinal).toBe(true);
    });
  });

  describe('empty input', () => {
    it('returns an empty body with a diagnostic note', () => {
      const out = composeTranscript(baseInput({ moduleResults: [] }));
      expect(out.lines).toEqual([]);
      expect(out.yearSummaries).toEqual([]);
      expect(out.totals.totalCredits).toBe(0);
      expect(out.totals.finalAverage).toBeNull();
      expect(out.notes.some((n) => n.includes('No CONFIRMED'))).toBe(true);
    });
  });
});
