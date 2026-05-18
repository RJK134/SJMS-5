/**
 * Phase 17E — Transcript composition pure utility.
 *
 * Given a student's identity, their enrolment context, the full body of
 * CONFIRMED ModuleResults across the programme, and an optional AwardRecord
 * (when an award has been classified), returns a structured transcript
 * payload the service layer can persist into Transcript + TranscriptLine
 * rows or render to PDF.
 *
 * Pure — no Prisma, no file system, no network, no PDF rendering. The
 * companion service layer (`transcripts.service::composeForStudent`)
 * loads the inputs and persists the outputs. Splitting the pure layer
 * out keeps the layout / formatting rules unit-testable in isolation
 * and reusable by future PDF / portal renderers.
 *
 * The transcript follows standard UK HE practice:
 *
 *   Header:    student identity, programme, dates, transcript type.
 *   Body:      one line per CONFIRMED ModuleResult, grouped by academic
 *              year (most recent first), with module code / title /
 *              credits / mark / grade.
 *   Summary:   total credits considered, weighted average across rows
 *              with an aggregateMark, classification (when an award
 *              record exists).
 *
 * Two transcript types are supported:
 *
 *   INTERIM:   produced during a programme — no AwardRecord required.
 *              Always available so a student can view / download a
 *              snapshot of progress at any point.
 *   FINAL:     produced after award classification — requires an
 *              AwardRecord with status RECOMMENDED, APPROVED, or
 *              CONFERRED. The header and summary include the
 *              classification.
 *
 * REPLACEMENT is also a schema-supported type but the composition
 * logic is identical to FINAL; the difference is operational
 * provenance rather than data shape, so the caller picks the type.
 */

/** Schema-compatible transcript type. */
export type TranscriptType = 'INTERIM' | 'FINAL' | 'REPLACEMENT';

/** ModuleResult projection consumed by the composer. */
export interface ModuleResultForTranscript {
  id: string;
  moduleId: string;
  /** Module code as it appears on the published handbook (e.g. "CS401"). */
  moduleCode: string;
  /** Module title for the transcript line. */
  moduleTitle: string;
  /** Credit value of the underlying Module. */
  credits: number;
  /** Aggregate percentage from 17A / 17C. */
  aggregateMark: number | null;
  /** Resolved letter grade. */
  grade: string | null;
  /** Academic year the result belongs to (e.g. "2025/26"). */
  academicYear: string;
  /** ModuleResult.status — the composer trusts the caller has filtered to CONFIRMED. */
  status: string;
}

/** Programme summary projection for the header. */
export interface ProgrammeForTranscript {
  id: string;
  programmeCode: string;
  title: string;
  level: string;
  awardingBody: string;
}

/** Student summary projection for the header. */
export interface StudentForTranscript {
  id: string;
  studentNumber: string;
  /** Student's full name as held on the Person record. */
  fullName: string;
  /** Student's date of birth — required by some external transcript consumers. */
  dateOfBirth: string | null;
}

/** Award record projection — null when no classification has been done. */
export interface AwardForTranscript {
  id: string;
  awardTitle: string;
  classification: string | null;
  finalAverage: number | null;
  awardDate: string | null;
  /** AwardStatus — RECOMMENDED / APPROVED / CONFERRED / REVOKED. */
  status: string;
}

/** Inputs to the composer. */
export interface ComposeTranscriptInput {
  student: StudentForTranscript;
  programme: ProgrammeForTranscript;
  moduleResults: ReadonlyArray<ModuleResultForTranscript>;
  award: AwardForTranscript | null;
  transcriptType: TranscriptType;
  /** When generated; defaults to "now" but the caller can pass a deterministic value for testing. */
  generatedDate: Date;
  /** Operator id (Keycloak sub) who generated the transcript. */
  generatedBy: string;
}

/** A single line on the rendered transcript. */
export interface TranscriptLine {
  moduleCode: string;
  moduleTitle: string;
  credits: number;
  mark: number | null;
  grade: string | null;
  academicYear: string;
  /** Stable ordering — most recent academic year first, then module code asc. */
  sortOrder: number;
}

/** Year-level summary for the transcript body. */
export interface YearSummary {
  academicYear: string;
  totalCredits: number;
  /** Credits where a mark or grade has been recorded (i.e. the assessment outcome
   *  is known). Distinct from "passed credits" — a module with grade 'FAIL' still
   *  contributes here. Use `progression-decision.ts` for pass/fail accounting. */
  recordedCredits: number;
  averageMark: number | null;
  lineCount: number;
}

/** Outcome returned by the composer. */
export interface TranscriptComposition {
  /** Header — printed at the top of the transcript. */
  header: {
    studentNumber: string;
    studentName: string;
    dateOfBirth: string | null;
    programmeCode: string;
    programmeTitle: string;
    programmeLevel: string;
    awardingBody: string;
    transcriptType: TranscriptType;
    generatedDate: Date;
    generatedBy: string;
  };
  /** All transcript lines, ordered most-recent-year-first then module code asc. */
  lines: TranscriptLine[];
  /** Per-year totals for the body summary. */
  yearSummaries: YearSummary[];
  /** Programme-wide totals for the footer. */
  totals: {
    totalCredits: number;
    /** Credits where a mark or grade has been recorded. See YearSummary.recordedCredits. */
    recordedCredits: number;
    finalAverage: number | null;
    contributingLineCount: number;
  };
  /** Award block — null when no AwardRecord exists / award not yet classified. */
  award: {
    title: string;
    classification: string | null;
    finalAverage: number | null;
    awardDate: string | null;
    status: string;
  } | null;
  /** True when the input set is internally consistent for a FINAL transcript. */
  isFinal: boolean;
  /** Diagnostic notes — empty for a fully clean composition. */
  notes: string[];
}

function roundToTwoDp(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compose a transcript from the supplied inputs. Pure — does NOT touch
 * Prisma. Returns a structured payload that callers can render or
 * persist verbatim (the keys mirror the Transcript / TranscriptLine
 * Prisma shape so the service layer's persistence path is mechanical).
 */
export function composeTranscript(input: ComposeTranscriptInput): TranscriptComposition {
  const notes: string[] = [];

  // FINAL transcript validation — refuse to misrepresent provenance by
  // emitting a FINAL transcript when no AwardRecord has been classified.
  // The composer still produces a body so the operator can inspect
  // what they would have got, but the output is flagged as not-final
  // and we add a note.
  let isFinal = true;
  if (input.transcriptType === 'FINAL' && !input.award) {
    isFinal = false;
    notes.push('FINAL transcript requested but no AwardRecord exists — output is preview-only.');
  }
  if (input.transcriptType === 'FINAL' && input.award && input.award.status === 'REVOKED') {
    isFinal = false;
    notes.push('AwardRecord is REVOKED — FINAL transcript should not be issued.');
  }

  // Sort lines by academic year (descending — most recent first) then
  // module code ascending. The sort is stable via the secondary key.
  const sorted = [...input.moduleResults].sort((a, b) => {
    if (a.academicYear !== b.academicYear) {
      // String comparison is sufficient because UK academic years are
      // stored as "YYYY/YY" — lexicographic order matches chronological
      // order within a century.
      return a.academicYear < b.academicYear ? 1 : -1;
    }
    if (a.moduleCode !== b.moduleCode) {
      return a.moduleCode < b.moduleCode ? -1 : 1;
    }
    return 0;
  });

  // Build lines and per-year summaries in the same pass.
  const lines: TranscriptLine[] = [];
  const yearMap = new Map<string, YearSummary & { weightedSum: number; contributingCredits: number }>();

  let totalCredits = 0;
  let recordedCredits = 0;
  let weightedSumAll = 0;
  let contributingCreditsAll = 0;
  let contributingLineCount = 0;

  let i = 0;
  for (const r of sorted) {
    if (r.credits <= 0) {
      notes.push(`Skipped module ${r.moduleCode} — non-positive credits (${r.credits}).`);
      continue;
    }

    lines.push({
      moduleCode: r.moduleCode,
      moduleTitle: r.moduleTitle,
      credits: r.credits,
      mark: r.aggregateMark,
      grade: r.grade,
      academicYear: r.academicYear,
      sortOrder: i,
    });
    i += 1;

    totalCredits += r.credits;
    // Count credits where an outcome has been recorded (mark or grade present).
    // This is intentionally permissive — a FAIL grade still counts as recorded.
    // For pass/fail accounting, see `progression-decision.ts`.
    if (r.aggregateMark != null || r.grade != null) {
      recordedCredits += r.credits;
    }

    if (r.aggregateMark != null) {
      weightedSumAll += r.aggregateMark * r.credits;
      contributingCreditsAll += r.credits;
      contributingLineCount += 1;
    }

    const existing = yearMap.get(r.academicYear);
    if (existing) {
      existing.totalCredits += r.credits;
      if (r.aggregateMark != null || r.grade != null) existing.recordedCredits += r.credits;
      if (r.aggregateMark != null) {
        existing.weightedSum += r.aggregateMark * r.credits;
        existing.contributingCredits += r.credits;
      }
      existing.lineCount += 1;
    } else {
      yearMap.set(r.academicYear, {
        academicYear: r.academicYear,
        totalCredits: r.credits,
        recordedCredits: r.aggregateMark != null || r.grade != null ? r.credits : 0,
        averageMark: null,
        lineCount: 1,
        weightedSum: r.aggregateMark != null ? r.aggregateMark * r.credits : 0,
        contributingCredits: r.aggregateMark != null ? r.credits : 0,
      });
    }
  }

  // Resolve per-year averages now that all rows are seen.
  const yearSummaries: YearSummary[] = Array.from(yearMap.values())
    .map((y) => ({
      academicYear: y.academicYear,
      totalCredits: y.totalCredits,
      recordedCredits: y.recordedCredits,
      averageMark: y.contributingCredits > 0 ? roundToTwoDp(y.weightedSum / y.contributingCredits) : null,
      lineCount: y.lineCount,
    }))
    .sort((a, b) => (a.academicYear < b.academicYear ? 1 : -1));

  const finalAverage = contributingCreditsAll > 0 ? roundToTwoDp(weightedSumAll / contributingCreditsAll) : null;

  if (lines.length === 0) {
    notes.push('No CONFIRMED module results contributed to the transcript.');
  }

  return {
    header: {
      studentNumber: input.student.studentNumber,
      studentName: input.student.fullName,
      dateOfBirth: input.student.dateOfBirth,
      programmeCode: input.programme.programmeCode,
      programmeTitle: input.programme.title,
      programmeLevel: input.programme.level,
      awardingBody: input.programme.awardingBody,
      transcriptType: input.transcriptType,
      generatedDate: input.generatedDate,
      generatedBy: input.generatedBy,
    },
    lines,
    yearSummaries,
    totals: {
      totalCredits,
      recordedCredits,
      finalAverage,
      contributingLineCount,
    },
    award: input.award
      ? {
          title: input.award.awardTitle,
          classification: input.award.classification,
          finalAverage: input.award.finalAverage,
          awardDate: input.award.awardDate,
          status: input.award.status,
        }
      : null,
    isFinal,
    notes,
  };
}
