/**
 * Column synthesisers — phase D0 follow-up.
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

import { readCsvAll } from './csv-reader.mjs';
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
};

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
 * Today:
 *   - `academicYears`: Map<id, yearLabel> from academic_years.csv (~7 rows).
 *   - `personNames`: Map<personId, {firstName, lastName}> from person_names.csv
 *     (~63k rows; one pass at startup, cheap enough).
 *
 * Both auxiliary CSVs may legitimately not exist (older snapshots, partial
 * imports); we treat absence as "no lookup available" and let downstream
 * synthesisers fall back to their stub defaults.
 *
 * @param {string} dir — snapshot directory containing the .csv files
 */
export async function loadSynthContext(dir) {
  const ctx = {
    academicYears: new Map(),
    personNames: new Map(),
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

  return ctx;
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}
