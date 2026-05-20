/**
 * Column synthesisers — phase D0 follow-up (passes 1 + 2).
 *
 * The synthetic dataset (sjms-v4-integrated, 298 models) and the SJMS-5
 * Prisma schema (197 models) share most of their lineage, but a handful
 * of column names diverged. For example:
 *
 *   - `persons.csv` carries `dateOfBirth` but not `firstName` / `lastName`
 *     (those live on `person_names.csv` in the dataset's normalised shape).
 *     SJMS-5's `Person` model denormalises and requires both.
 *
 *   - `academic_years.csv` calls the academic-year label `year` (e.g.
 *     `2025/26`). SJMS-5's `AcademicYear.yearCode` carries the same value
 *     under a different field name.
 *
 *   - `programmes.csv` uses `code` / `name` / `nqfLevel`; SJMS-5 uses
 *     `programmeCode` / `title` / `level` (the latter as a ProgrammeLevel
 *     enum `LEVEL_3..LEVEL_8`).
 *
 * Rather than:
 *   (a) duplicating columns inside the dataset schema (would force the
 *       generator schema-hash to change and break dataset reproducibility), or
 *   (c) loosening required fields in `prisma/schema.prisma` (the production
 *       intent is genuinely required),
 *
 * we synthesise the missing column on the importer side. Each entry below
 * declares — per SJMS-5 model — how to fill a column that the CSV lacks.
 * The classifier treats a column with a synthesiser the same as a column
 * that's literally in the CSV header, so the table moves from
 * `skipped — shape` to `PLAN: ...`.
 *
 * Determinism: synthesisers either derive from another column in the same
 * row, look up a pre-loaded auxiliary CSV (passed via `synthCtx`), or use
 * a static stub. No RNG; the dataset is already seeded.
 *
 * British English throughout.
 */

import { readCsvAll, readCsvRows } from './csv-reader.mjs';
import path from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * Map an integer FHEQ / NQF level (3..8) to the SJMS-5 ProgrammeLevel enum.
 */
function fheqLevelToProgrammeLevel(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'LEVEL_6';
  const clamped = Math.max(3, Math.min(8, Math.round(n)));
  return `LEVEL_${clamped}`;
}

/**
 * Derive `personId` from an id like `p-00000001-a1` -> `p-00000001`.
 * Strips a trailing suffix like `-a1`, `-n1`, `-pn1`, `-c1`, `-cz1`.
 */
function personIdFromCompositeId(id) {
  if (!id || typeof id !== 'string') return null;
  return id.replace(/-[a-z]{1,3}\d+$/, '');
}

/**
 * Derive an ISO week number (1..53) from a date string. Used by
 * EngagementScore.weekNumber as a fallback when the CSV lacks one.
 * Empty / unparseable input returns 1 (deterministic floor).
 */
function isoWeekNumber(value) {
  if (!value) return 1;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 1;
  // ISO 8601: week containing the first Thursday of the year is week 1.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
}

/**
 * Map the dataset's `feeEligibility` (HOME / OVERSEAS / EU_REINSTATED) to
 * the SJMS-5 FeeStatus enum. The dataset's EU_REINSTATED maps to the
 * post-Brexit transitional bucket SJMS-5 calls EU_TRANSITIONAL.
 */
function feeEligibilityToFeeStatus(raw) {
  switch ((raw || '').toUpperCase()) {
    case 'OVERSEAS':       return 'OVERSEAS';
    case 'EU_REINSTATED':  return 'EU_TRANSITIONAL';
    case 'ISLANDS':        return 'ISLANDS';
    case 'CHANNEL_ISLANDS':return 'CHANNEL_ISLANDS';
    default:               return 'HOME'; // modal UK value
  }
}

/**
 * Map the dataset's `ProgressionDecision` long-form enum
 * (PROGRESS_TO_NEXT_YEAR / etc.) to SJMS-5's shorter ProgressionDecision
 * enum (PROGRESS / REPEAT_YEAR / REPEAT_MODULES / WITHDRAW / TRANSFER /
 * AWARD).
 */
function progressionDecisionMap(raw) {
  switch ((raw || '').toUpperCase()) {
    case 'PROGRESS_TO_NEXT_YEAR':
    case 'PROGRESS':                return 'PROGRESS';
    case 'REPEAT_YEAR':             return 'REPEAT_YEAR';
    case 'REPEAT_MODULES':
    case 'REPEAT_FAILED_MODULES':   return 'REPEAT_MODULES';
    case 'WITHDRAW':
    case 'WITHDRAWN':               return 'WITHDRAW';
    case 'TRANSFER':                return 'TRANSFER';
    case 'AWARD':
    case 'AWARDED':                 return 'AWARD';
    default:                        return 'PROGRESS';
  }
}

/**
 * Map the dataset's consent `purpose` to SJMS-5's ConsentType enum.
 * The dataset uses operational labels (ACADEMIC_ASSESSMENT,
 * STATUTORY_REPORTING, etc.); SJMS-5's ConsentType is a smaller categorical
 * (MARKETING / RESEARCH / DATA_SHARING / PHOTOGRAPHY / ALUMNI /
 * THIRD_PARTY). The mapping below is conservative — anything
 * operational that is not unambiguously marketing / research / alumni
 * collapses to DATA_SHARING.
 */
function consentPurposeToType(raw) {
  switch ((raw || '').toUpperCase()) {
    case 'MARKETING_COMMUNICATIONS':
    case 'MARKETING':                  return 'MARKETING';
    case 'RESEARCH_PARTICIPATION':
    case 'RESEARCH':                   return 'RESEARCH';
    case 'ALUMNI_RELATIONS':
    case 'ALUMNI':                     return 'ALUMNI';
    case 'PHOTOGRAPHY':                return 'PHOTOGRAPHY';
    case 'THIRD_PARTY':
    case 'THIRD_PARTY_SHARING':        return 'THIRD_PARTY';
    case 'ACADEMIC_ASSESSMENT':
    case 'STATUTORY_REPORTING':
    default:                           return 'DATA_SHARING';
  }
}

/**
 * Per-SJMS-5-model column synthesisers.
 *
 * Each entry is { sjms5FieldName: (rawRow, synthCtx) => string|null }.
 * Returning `null` or `undefined` means "leave the field empty"; the
 * coercer will then enforce required-vs-optional semantics.
 */
export const COLUMN_SYNTHESISERS = {
  AcademicYear: {
    // dataset emits `year` (e.g. "2025/26"); SJMS-5 calls it `yearCode`
    yearCode: (r) => r.year,
  },

  User: {
    // SJMS-5 stores a Keycloak subject id. The dataset's seed users carry
    // a stable id like `user-vc`; deriving `kc-user-vc` keeps a 1:1
    // mapping the importer can re-derive on every run.
    keycloakId: (r) => `kc-${r.id}`,
  },

  Person: {
    // names live on person_names.csv in the dataset; SJMS-5's Person
    // denormalises them onto the Person row. We pre-load person_names
    // once per import and look up by personId.
    firstName: (r, synthCtx) => synthCtx.personNames?.get(r.id)?.firstName ?? 'Unknown',
    lastName:  (r, synthCtx) => synthCtx.personNames?.get(r.id)?.lastName ?? 'Person',
  },

  PersonName: {
    // dataset uses `effectiveFrom` / `effectiveTo`; SJMS-5 uses `startDate` / `endDate`
    startDate: (r) => r.effectiveFrom,
    endDate:   (r) => r.effectiveTo || null,
  },

  PersonAddress: {
    // person_addresses.csv in the dataset has no personId column — it's
    // implicit in the row id (e.g. `p-00000001-a1`). Recover it.
    personId:     (r) => personIdFromCompositeId(r.id),
    // dataset address shape is line1/line2/line3; SJMS-5 is addressLine{1,2,3}.
    addressLine1: (r) => r.line1,
    addressLine2: (r) => r.line2 || null,
    addressLine3: (r) => r.line3 || null,
    // dataset has no addressType — every seeded address is the person's
    // home address (set via the person factory's `usageType: 'HOME'`).
    addressType:  () => 'HOME',
    // dataset has no startDate on PersonAddress — the row's createdAt is
    // a reasonable lower bound (when the address was first recorded).
    startDate:    (r) => r.createdAt,
  },

  PersonNationality: {
    // dataset uses `nationalityCode`; SJMS-5 uses `countryCode`.
    countryCode: (r) => r.nationalityCode,
  },

  Programme: {
    programmeCode: (r) => r.code,
    title:         (r) => r.name,
    level:         (r) => fheqLevelToProgrammeLevel(r.fheqLevel ?? r.nqfLevel),
    // dataset stores per-module credits, not a programme total. UK UG
    // honours degrees are 360 credits, PG taught are 180, PG research
    // are 540. Fall back by level; precise derivation would require
    // summing programme_modules which is heavier than this pass warrants.
    creditTotal: (r) => {
      const lvl = Number(r.fheqLevel ?? r.nqfLevel);
      if (lvl >= 8) return '540';
      if (lvl >= 7) return '180';
      return '360';
    },
  },

  Module: {
    moduleCode: (r) => r.code,
    title:      (r) => r.name,
    // dataset stores fheqLevel as a number (3..8); SJMS-5 keeps level as Int.
    level:      (r) => r.fheqLevel ?? r.creditLevel ?? '6',
  },

  Enrolment: {
    // dataset has academicYearId (e.g. `ay-2025-26`); SJMS-5 wants the
    // human-readable academic-year label (e.g. "2025/26"). Look it up
    // from the pre-loaded academic-year map.
    academicYear: (r, synthCtx) => synthCtx.academicYears?.get(r.academicYearId) ?? null,
    yearOfStudy:  (r) => r.yearOfProgramme,
    startDate:    (r) => r.enrolmentDate,
    // dataset doesn't store feeStatus on Enrolment — it's on Student. We
    // can't cross-reference cheaply per row, so we default to HOME (the
    // modal UK value). A future pass could pre-load students.csv and
    // join, but that's a larger lift than this phase budgets.
    feeStatus:    () => 'HOME',
  },

  ModuleRegistration: {
    academicYear:     (r, synthCtx) => synthCtx.academicYears?.get(r.academicYearId) ?? null,
    // dataset has no registrationType — modal value across UK HE programmes
    // is CORE (compulsory modules). Optional / elective modules are the
    // exception, not the rule.
    registrationType: () => 'CORE',
  },

  // ═════════════════════════════════════════════════════════════════════
  // Pass 2 — closing the next-tier shape gaps
  // ═════════════════════════════════════════════════════════════════════

  Student: {
    // Dataset's per-student `feeEligibility` enum (HOME/OVERSEAS/EU_REINSTATED)
    // maps cleanly to SJMS-5's FeeStatus.
    feeStatus:         (r) => feeEligibilityToFeeStatus(r.feeEligibility),
    // Dataset has no `entryRoute` column. UCAS is the modal route in UK HE
    // (≈80% of UG admissions); use it as the safe deterministic stub.
    entryRoute:        () => 'UCAS',
    // Dataset has no `originalEntryDate`. Use the earliest enrolmentDate
    // we've seen for this student (pre-loaded), else the row's createdAt.
    originalEntryDate: (r, synthCtx) => synthCtx.firstEnrolmentDateByStudent?.get(r.id) ?? r.createdAt ?? null,
  },

  ConsentRecord: {
    // Dataset stores consent per Person; SJMS-5 stores per Student. We
    // pre-load students.csv into a personId→studentId map. A consent row
    // whose personId is not a student (~14% of persons aren't students)
    // returns null and the row coercer skips it as orphan.
    studentId:   (r, synthCtx) => synthCtx.studentIdByPersonId?.get(r.personId) ?? null,
    consentType: (r) => consentPurposeToType(r.purpose),
  },

  StudentInstance: {
    // dataset stores StudentInstance keyed by enrolmentId; pulls the
    // student / programme / academic-year / year-of-study off the
    // pre-loaded enrolments map.
    studentId:      (r, synthCtx) => synthCtx.enrolments?.get(r.enrolmentId)?.studentId ?? null,
    programmeId:    (r, synthCtx) => synthCtx.enrolments?.get(r.enrolmentId)?.programmeId ?? null,
    academicYearId: (r, synthCtx) => synthCtx.enrolments?.get(r.enrolmentId)?.academicYearId ?? null,
    yearOfStudy:    (r, synthCtx) => synthCtx.enrolments?.get(r.enrolmentId)?.yearOfProgramme ?? '1',
  },

  EngagementScore: {
    academicYear:   (r, synthCtx) => synthCtx.academicYears?.get(r.academicYearId) ?? null,
    // dataset has no week number — compute the ISO week from
    // calculatedDate; fall back to week 1 when blank (deterministic).
    weekNumber:     (r) => String(isoWeekNumber(r.calculatedDate || r.createdAt)),
    // calculatedDate is required by the schema but often empty in the
    // dataset; fall back to createdAt so coercion succeeds.
    calculatedDate: (r) => r.calculatedDate || r.createdAt || null,
  },

  ProgressionRecord: {
    academicYear:         (r, synthCtx) => synthCtx.academicYears?.get(r.academicYearId) ?? null,
    // year-of-study lives on the parent enrolment.
    yearOfStudy:          (r, synthCtx) => synthCtx.enrolments?.get(r.enrolmentId)?.yearOfProgramme ?? '1',
    // dataset stores `credits` as the credits *attempted* in the year;
    // for `totalCreditsPassed`, default to the same value when no
    // explicit failure data is present (the row only reaches the
    // progression-records table if the board has decided, so credits is
    // the operative passed count).
    totalCreditsAttempted: (r) => r.credits || '120',
    totalCreditsPassed:    (r) => r.credits || '120',
    progressionDecision:   (r) => progressionDecisionMap(r.decision),
  },

  Assessment: {
    academicYear: (r, synthCtx) => synthCtx.academicYears?.get(r.academicYearId) ?? null,
    // dataset's `weight` column is currently empty across the snapshot;
    // 50% is the modal coursework weighting. `maxMark` defaults to 100
    // (the standard UK HE per-component scale).
    weighting:    (r) => r.weight || '50',
    maxMark:      (r) => r.maximumMark || '100',
  },

  AssessmentCriteria: {
    // dataset's assessment_criteria keys by componentId
    // (assessment_components.csv); SJMS-5's AssessmentCriteria attaches
    // directly to Assessment. Pre-loaded map componentId→assessmentId.
    assessmentId: (r, synthCtx) => synthCtx.assessmentIdByComponentId?.get(r.componentId) ?? null,
    // dataset uses `description` for the criterion text; SJMS-5 wants
    // both `title` (short label) and `description` (long form). When the
    // dataset has only the long form, derive a 60-char title from it.
    title:        (r) => (r.description && r.description.length > 60 ? r.description.slice(0, 60) : r.description) || 'Criterion',
    // dataset has no per-criterion maxMark; 100 is the typical full-scale
    // mark used by UK HE rubrics. Weighting is already a column.
    maxMark:      () => '100',
  },

  Document: {
    // dataset uses fileName/fileUrl; SJMS-5 uses title/filePath.
    title:    (r) => r.fileName,
    filePath: (r) => r.fileUrl,
  },

  Applicant: {
    // dataset's applicants.csv has no applicantNumber. Use the row id as
    // a deterministic unique stand-in (preserves uniqueness, idempotent).
    applicantNumber:  (r) => r.id,
    // dataset has no applicationRoute on Applicant — modal UK undergrad
    // route is UCAS.
    applicationRoute: () => 'UCAS',
  },

  Application: {
    // Derive academic year from applicationDate (UK admissions cycle:
    // applications for entry in academic year N/N+1 are submitted in
    // Sept N-1 → Aug N).
    academicYear:     (r, synthCtx) => academicYearFromDate(r.applicationDate, synthCtx),
    applicationRoute: () => 'UCAS',
  },

  RoomBooking: {
    // dataset has `bookingDate`; SJMS-5 calls it `date`.
    date: (r) => r.bookingDate,
  },

  Certificate: {
    // dataset's certificates.graduandId → graduand_records → studentId.
    studentId:          (r, synthCtx) => synthCtx.studentIdByGraduandId?.get(r.graduandId) ?? null,
    // dataset uses `serialNumber`; SJMS-5 uses `certificateNumber`.
    certificateNumber:  (r) => r.serialNumber,
    issueDate:          (r) => r.issuedDate,
  },

  AccommodationBooking: {
    // dataset uses checkInDate/checkOutDate; SJMS-5 uses startDate/endDate.
    startDate:  (r) => r.checkInDate || r.createdAt,
    endDate:    (r) => r.checkOutDate || r.checkInDate || r.createdAt,
    // Neither weeklyRent nor totalCost lives on the booking row in the
    // dataset — they're on the AccommodationRoom. We default to a
    // representative UK student-hall weekly rent (£140) and a 40-week
    // contract total. A future pass can join AccommodationRoom for
    // precise values; this stub keeps the row importable.
    weeklyRent: () => '140',
    totalCost:  () => '5600',
  },

  Faculty: {
    // dataset uses `name`; SJMS-5 uses `title`.
    title: (r) => r.name,
  },

  Room: {
    // dataset uses `code`; SJMS-5 uses `roomCode`. `building` is not on
    // the row but can be derived from `buildingId` (the building code is
    // the meaningful suffix of the id).
    roomCode: (r) => r.code,
    building: (r) => r.buildingId || 'Unknown Building',
  },

  Committee: {
    committeeName: (r) => r.name,
  },

  StaffContract: {
    // dataset's StaffRecord (`srec-stf-...`) is renamed Staff
    // (`staff-stf-...`) in SJMS-5; the suffix is identical and stable so
    // the rename is a deterministic prefix swap.
    staffId: (r) => (r.staffRecordId ? r.staffRecordId.replace(/^srec-/, 'staff-') : null),
  },

  StaffQualification: {
    staffId:     (r) => (r.staffRecordId ? r.staffRecordId.replace(/^srec-/, 'staff-') : null),
    // dataset has `qualificationType` (e.g. PhD, MA); SJMS-5 calls it `qualTitle`.
    qualTitle:   (r) => r.qualificationType,
    // dataset has `awardingBody`; SJMS-5 calls it `institution`.
    institution: (r) => r.awardingBody,
  },
};

/**
 * Derive a SJMS-5 academic-year label (e.g. "2025/26") from a date string,
 * using the UK HE convention that the year starts on 1 September.
 */
function academicYearFromDate(value, synthCtx) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1..12
  const startYear = month >= 9 ? year : year - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  const label = `${startYear}/${endYY}`;
  // sanity-check against the known AY map (returns the same string when
  // the AY exists in the dataset; otherwise null)
  if (synthCtx?.academicYears) {
    for (const v of synthCtx.academicYears.values()) {
      if (v === label) return label;
    }
    return null;
  }
  return label;
}

/**
 * Returns the set of SJMS-5 field names for `model` that we can synthesise
 * even if the CSV header lacks them.
 */
export function synthesisableFields(modelName) {
  return new Set(Object.keys(COLUMN_SYNTHESISERS[modelName] ?? {}));
}

/**
 * Apply synthesisers to a raw CSV row. Mutates and returns the row with
 * the SJMS-5 column names added (the original dataset columns are left in
 * place — the coercer iterates over importableFields, so untouched cells
 * are ignored).
 *
 * @param {string} modelName        — SJMS-5 model name (e.g. "Person")
 * @param {Record<string,string>} row
 * @param {object} synthCtx         — auxiliary lookups (see loadSynthContext)
 */
export function applySynthesisers(modelName, row, synthCtx) {
  const synths = COLUMN_SYNTHESISERS[modelName];
  if (!synths) return row;
  for (const [field, fn] of Object.entries(synths)) {
    const existing = row[field];
    if (existing !== undefined && existing !== '') continue; // CSV value wins
    const v = fn(row, synthCtx);
    row[field] = v == null ? '' : String(v);
  }
  return row;
}

/**
 * Pre-load auxiliary lookups that some synthesisers need.
 *
 * Pass 1 lookups:
 *   - `academicYears`: Map<id, yearLabel> from academic_years.csv (~7 rows).
 *   - `personNames`: Map<personId, {firstName, lastName}> from person_names.csv
 *     (~63k rows; one pass at startup, cheap enough).
 *
 * Pass 2 lookups (added for the next wave of synthesisers):
 *   - `studentIdByPersonId`: Map<personId, studentId> from students.csv
 *     (~52k rows). Lets ConsentRecord bridge dataset's per-person consent
 *     to SJMS-5's per-student consent.
 *   - `firstEnrolmentDateByStudent`: Map<studentId, earliestEnrolmentDate>
 *     from enrolments.csv (~79k rows). Backs Student.originalEntryDate
 *     when the dataset has no explicit column.
 *   - `enrolments`: Map<enrolmentId, {studentId, programmeId,
 *     academicYearId, yearOfProgramme}> from enrolments.csv. Backs
 *     StudentInstance and ProgressionRecord cross-references.
 *   - `assessmentIdByComponentId`: Map<componentId, assessmentId> from
 *     assessment_components.csv. Backs AssessmentCriteria.assessmentId.
 *   - `studentIdByGraduandId`: Map<graduandId, studentId> from
 *     graduand_records.csv. Backs Certificate.studentId.
 *
 * All auxiliary CSVs may legitimately not exist (older snapshots, partial
 * imports); we treat absence as "no lookup available" and let downstream
 * synthesisers fall back to their stub defaults.
 *
 * @param {string} dir — snapshot directory containing the .csv files
 */
export async function loadSynthContext(dir) {
  const ctx = {
    academicYears: new Map(),
    personNames: new Map(),
    studentIdByPersonId: new Map(),
    firstEnrolmentDateByStudent: new Map(),
    enrolments: new Map(),
    assessmentIdByComponentId: new Map(),
    studentIdByGraduandId: new Map(),
  };

  const ayPath = path.join(dir, 'academic_years.csv');
  if (await fileExists(ayPath)) {
    for (const row of await readCsvAll(ayPath)) {
      if (row.id && row.year) ctx.academicYears.set(row.id, row.year);
    }
  }

  const pnPath = path.join(dir, 'person_names.csv');
  if (await fileExists(pnPath)) {
    for (const row of await readCsvAll(pnPath)) {
      // Only keep the current (LEGAL, is_current) name per person — the
      // dataset emits one per person at LEGAL/isCurrent=true, so a simple
      // last-wins assignment is correct and deterministic.
      if (row.personId && (row.firstName || row.lastName)) {
        ctx.personNames.set(row.personId, {
          firstName: row.firstName,
          lastName: row.lastName,
        });
      }
    }
  }

  // students.csv is the canonical bridge between persons and students.
  // Stream rather than load (it's 52k rows; we only need two columns).
  const studPath = path.join(dir, 'students.csv');
  if (await fileExists(studPath)) {
    for await (const row of readCsvRows(studPath)) {
      if (row.personId && row.id) ctx.studentIdByPersonId.set(row.personId, row.id);
    }
  }

  // enrolments.csv — pre-load the lookup for StudentInstance / ProgressionRecord,
  // and accumulate the per-student first-enrolment-date for Student.originalEntryDate.
  const enrolPath = path.join(dir, 'enrolments.csv');
  if (await fileExists(enrolPath)) {
    for await (const row of readCsvRows(enrolPath)) {
      if (!row.id) continue;
      ctx.enrolments.set(row.id, {
        studentId: row.studentId,
        programmeId: row.programmeId,
        academicYearId: row.academicYearId,
        yearOfProgramme: row.yearOfProgramme,
      });
      if (row.studentId && row.enrolmentDate) {
        const prev = ctx.firstEnrolmentDateByStudent.get(row.studentId);
        if (!prev || row.enrolmentDate < prev) {
          ctx.firstEnrolmentDateByStudent.set(row.studentId, row.enrolmentDate);
        }
      }
    }
  }

  // assessment_components.csv — componentId → assessmentId for criteria.
  const compPath = path.join(dir, 'assessment_components.csv');
  if (await fileExists(compPath)) {
    for await (const row of readCsvRows(compPath)) {
      if (row.id && row.assessmentId) ctx.assessmentIdByComponentId.set(row.id, row.assessmentId);
    }
  }

  // graduand_records.csv — graduandId → studentId for Certificate.
  const grandPath = path.join(dir, 'graduand_records.csv');
  if (await fileExists(grandPath)) {
    for await (const row of readCsvRows(grandPath)) {
      if (row.id && row.studentId) ctx.studentIdByGraduandId.set(row.id, row.studentId);
    }
  }

  return ctx;
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}
