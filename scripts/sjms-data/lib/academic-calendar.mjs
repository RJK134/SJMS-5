/**
 * UK academic calendar utilities.
 *
 * Reconciles two overlapping year-shapes a UK university tracks:
 *
 *   - Academic year (AY):  Sep–Aug    (HESA-aligned, drives enrolments)
 *   - Financial year (FY): Aug–Jul    (most UK HEIs; UCEA aligns to this)
 *
 * 5-year history target for the dataset: AY 2020/21 through AY 2025/26.
 * Current "active" year for the cycle 2026/27 admissions is AY 2026/27.
 *
 * Term dates use a typical semesterised calendar (most UK HEIs):
 *   Sem 1: Sep – mid-Jan + Jan exams
 *   Sem 2: mid-Jan – mid-May + May/June exams
 *   Summer resits: late Aug
 *
 * The dates are realistic-but-synthetic — they do not match any one
 * institution's calendar exactly. Sources: HESA Coding Manual session
 * year definitions; UCAS application cycle timetable.
 */

export const ACADEMIC_YEARS = [
  '2020/21', '2021/22', '2022/23', '2023/24', '2024/25', '2025/26', '2026/27',
];

export const CURRENT_ADMISSIONS_CYCLE = '2026/27';
export const CURRENT_ACTIVE_YEAR = '2025/26';

/** Convert "2024/25" → { startYear: 2024, endYear: 2025 } */
export function parseAcademicYear(ayLabel) {
  const m = ayLabel.match(/^(\d{4})\/(\d{2})$/);
  if (!m) throw new Error(`Invalid academic year label: ${ayLabel}`);
  return { startYear: parseInt(m[1], 10), endYear: 2000 + parseInt(m[2], 10) };
}

/** AY 2024/25 → start ISO date '2024-09-23' (typical Welcome Week Monday) */
export function ayStartDate(ayLabel) {
  const { startYear } = parseAcademicYear(ayLabel);
  // Welcome Week typically the week containing the last Monday of September.
  // We pick the Monday in the 23–29 window each year for stability.
  const candidate = new Date(Date.UTC(startYear, 8, 23));
  while (candidate.getUTCDay() !== 1) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.toISOString().slice(0, 10);
}

/** AY 2024/25 → end ISO date '2025-08-31' */
export function ayEndDate(ayLabel) {
  const { endYear } = parseAcademicYear(ayLabel);
  return `${endYear}-08-31`;
}

/** AY 2024/25 → FY label per UK HE convention */
export function ayToFinancialYear(ayLabel) {
  // UK HE financial year runs 1 Aug → 31 Jul. Academic year 2024/25 ⇒ FY 2024/25.
  return ayLabel;
}

/** Term-week index (1-based) into ISO date — typical semester 1 starts on ayStartDate */
export function weekDate(ayLabel, weekIndex) {
  const start = new Date(ayStartDate(ayLabel) + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() + (weekIndex - 1) * 7);
  return start.toISOString().slice(0, 10);
}

/**
 * UCAS application cycle dates for a given admissions cycle (AY 2026/27).
 * Cycle opens September of the year prior to entry.
 *   - Apply opens:           mid-September of (entry year - 1)
 *   - Equal-consideration:   29 January of entry year
 *   - Final deadline:        end of June of entry year (mostly)
 *   - Clearing opens:        July of entry year
 *   - Confirmation deadline: end of August
 * Source: UCAS Undergraduate Admissions Cycle.
 */
export function ucasCycleDates(ayLabel) {
  const { startYear } = parseAcademicYear(ayLabel);
  const entryYear = startYear;
  return {
    applyOpens: `${entryYear - 1}-09-12`,
    equalConsideration: `${entryYear}-01-29`,
    finalDeadline: `${entryYear}-06-30`,
    clearingOpens: `${entryYear}-07-05`,
    confirmationDeadline: `${entryYear}-08-31`,
  };
}

/**
 * Days between two ISO date strings — positive when b > a.
 */
export function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}

/** Cheap synchronous date shifter — '2024-09-23' + 14 days → '2024-10-07' */
export function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
