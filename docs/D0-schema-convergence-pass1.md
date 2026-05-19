# D0 — schema convergence pass 1

**Phase**: D0 follow-up.
**Branch**: `chore/sjms-dataset-shape-convergence-pass1`.
**Snapshot**: `output/2026-05-17/` (manifest seed `2026-05`, generated
`2026-05-17T19:40:11.653Z`).

## What this pass did

Closed the **ten highest-leverage shape gaps** between the
sjms-v4-integrated dataset (298 models) and the SJMS-5 Prisma schema
(197 models), so a clean run of
`node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17 --dry-run`
plans 21 tables (was 11) — adding ~762k rows of cascade-critical
parent data and the two largest student-facing fact tables.

The fix is a single new module — `scripts/sjms-data/lib/column-synthesisers.mjs`
— wired into the existing importer at two points:

1. **classifyTables** (shape check): a column with a registered
   synthesiser counts as "present" for the SJMS-5 `missing required`
   check, so the table moves from `skipped — shape` to `PLAN: ...`.
2. **upsertTableLive** (per-row coerce): the importer runs
   `applySynthesisers(model, row, synthCtx)` before `coerceRow`, so
   the synthesised value flows through the normal type-coerce path
   into Prisma.

Auxiliary lookups (academic-year ids → year labels, person ids →
{firstName, lastName}) are pre-loaded once at startup via
`loadSynthContext(dir)`.

## Tables addressed

| # | Table                 | Rows    | Fix type | Notes                                                                                                          |
|---|-----------------------|--------:|----------|----------------------------------------------------------------------------------------------------------------|
| 1 | `academic_years`      |       7 | (b)      | alias: `yearCode` ← `year` (dataset already emits "2025/26" in the `year` column)                              |
| 2 | `users`               |      11 | (b) stub | `keycloakId` = `kc-<id>`; SSO identity tied to dataset's stable seed-user ids                                  |
| 3 | `persons`             |  62,980 | (b) join | `firstName` / `lastName` looked up from `person_names.csv` keyed on `personId` (pre-loaded into a Map at start) |
| 4 | `person_names`        |  62,980 | (b)      | alias: `startDate` ← `effectiveFrom`, `endDate` ← `effectiveTo`                                                |
| 5 | `person_addresses`    |  62,980 | (b)      | `personId` derived from id prefix; `addressLine{1,2,3}` ← `line{1,2,3}`; `addressType` = `HOME`; `startDate` ← `createdAt` |
| 6 | `person_nationalities`|  62,980 | (b)      | alias: `countryCode` ← `nationalityCode`                                                                       |
| 7 | `programmes`          |     624 | (b)      | alias: `programmeCode` ← `code`, `title` ← `name`; `level` mapped from `fheqLevel` to `LEVEL_3..LEVEL_8`; `creditTotal` defaults by level (UG 360, PGT 180, PGR 540) |
| 8 | `modules`             |   3,360 | (b)      | alias: `moduleCode` ← `code`, `title` ← `name`, `level` ← `fheqLevel` (Int)                                    |
| 9 | `enrolments`          |  78,786 | (b)      | `academicYear` resolved via the AY id→label map; alias: `yearOfStudy` ← `yearOfProgramme`, `startDate` ← `enrolmentDate`; `feeStatus` stub `HOME` (modal UK value) |
| 10| `module_registrations`| 426,966 | (b)      | `academicYear` resolved via AY map; `registrationType` stub `CORE` (modal value across UK HE)                  |

**Fix types**:
- (a) extend the generator — *not used in this pass; deferred to a later
  schema-convergence pass once the generator schema migrates*.
- (b) extend the importer to synthesise a stub / alias / lookup — **all
  ten gaps closed via (b)**, via the new column-synthesisers module.
- (c) loosen the Prisma schema — *not used; production semantics genuinely
  require these columns*.

## Before / after coverage

```
                       BEFORE        AFTER       Δ
covered (tables)          11           21       +10
covered (rows)       251,655    1,013,329  +761,674
skipped — shape           55           45       -10
skipped — no model       227          227         0
skipped — no csv           5            5         0
```

10 newly-importable tables:

```
identity      users                       11
identity      persons                 62,980
identity      person_names            62,980
identity      person_addresses        62,980
identity      person_nationalities    62,980
reference     academic_years               7
curriculum    programmes                 624
curriculum    modules                  3,360
students      enrolments              78,786
students      module_registrations   426,966
```

## Residual diagnostics (45 tables still shape-incompatible)

The top residual gaps by row volume, all deferred to subsequent passes:

| Table                  | Rows    | Missing required (sample)                                                          |
|------------------------|--------:|------------------------------------------------------------------------------------|
| consent_records        | 231,920 | `studentId`, `consentType` — dataset is per-person; SJMS-5 is per-student          |
| payments               |  97,542 | `studentAccountId`, `transactionDate` — needs cross-table join                     |
| attendance_records     |  78,786 | `date` — derivable, but FK `moduleRegistrationId` is empty in dataset stubs        |
| engagement_scores      |  78,786 | `academicYear`, `weekNumber` — academicYear is synthesisable; weekNumber needs deeper logic |
| invoices               |  78,786 | `studentAccountId`, `issueDate` — needs StudentAccount join                        |
| student_instances      |  78,786 | `studentId`, `programmeId`, `academicYearId`, `yearOfStudy` — needs Enrolment lookup |
| notification_preferences|60,000 | `userId`, `channel`, `category` — dataset stub rows have no real FK targets        |
| students               |  52,000 | `feeStatus`, `entryRoute`, `originalEntryDate` — Student row currently empty       |
| assessment_criteria    |  51,930 | `assessmentId`, `title`, `maxMark` — assessments domain gap                        |
| progression_records    |  38,786 | several — progression-rules dependency                                             |
| notifications          |  30,000 | `userId`, `category` — Notification stub rows                                      |
| assessments            |  25,965 | `academicYear`, `weighting`, `maxMark`                                             |

Several of these need a richer importer pass — e.g. pre-loading
students.csv to expose `Student.personId` for cross-referenced enrolment
fees; pre-loading `assessments.csv` to satisfy `AssessmentCriterion.assessmentId`.
Plan that work in pass 2.

## Tables considered but skipped this pass

- **`consent_records` (231,920 rows)** — schema-semantics mismatch
  (dataset records consent per Person; SJMS-5 records consent per
  Student). Bridging would require lossy filtering to student-rooted
  rows only.
- **`attendance_records` (78,786 rows)** — `date` is synthesisable but
  the required `moduleRegistrationId` FK is empty in the dataset
  generator stubs; would import as orphans.
- **`student_instances` (78,786 rows)** — needs four columns from
  Enrolment (studentId/programmeId/academicYearId/yearOfStudy); cleaner
  to do in a richer second pass with pre-loaded enrolments.
- **`students` (52,000 rows)** — Student table itself has no rows in
  the current snapshot (`student_record` is the dataset table). Domain-map
  gap, not a shape gap.
- **`invoices` / `payments` (~97k + 78k rows)** — finance models need
  StudentAccount cross-references that aren't trivial to derive without
  a join pass.

## Determinism

All synthesisers are pure functions of the row + a pre-loaded map; no
RNG, no time-varying state. The synthesiser catalogue is a frozen object
literal (verified by `scripts/test/column-synthesisers.test.mjs`'s
"covers every advertised SJMS-5 model" test).

The generator itself was not modified — this pass is importer-only —
so `output/2026-05-17/` does **not** need regenerating; the same
snapshot continues to be byte-identical to the recorded manifest hash.

## Test coverage

- `scripts/test/column-synthesisers.test.mjs` — 15 tests covering:
  - `synthesisableFields` field-set per model
  - `applySynthesisers` for alias / stub / lookup / no-op / CSV-wins
  - `loadSynthContext` reading both auxiliary CSVs and tolerating
    absence
  - `classifyTables` treats a synthesisable column as available
  - The catalogue covers every documented model
- `scripts/test/d12-importer.test.mjs` — existing 13 tests still pass
  (no regression in the upstream contract).

## Files changed

- `scripts/sjms-data/lib/column-synthesisers.mjs` — **new** (~240 lines)
- `scripts/import-sjms-dataset.mjs` — added synthesiser import, gated
  the shape check on `synthesisableFields()`, threaded `synthCtx` through
  `upsertTableLive` (+~25 lines net)
- `scripts/test/column-synthesisers.test.mjs` — **new** (~220 lines)
- `docs/D0-schema-convergence-pass1.md` — **this file**

Total diff: well under the 500-line cap.

## Follow-up (pass 2 candidates)

Order by leverage (cascade × row volume):

1. **`students` (52k rows)** — backfill from `student_record` CSV;
   unlocks Student FK consumers.
2. **`attendance_records` (78k)** — derive `date` AND fix the
   `moduleRegistrationId` FK derivation from `mr-*` ids.
3. **`student_instances` (78k)** — Enrolment-keyed lookup pass for
   studentId/programmeId/academicYearId.
4. **`engagement_scores` (78k)** — academicYear (same map we use here) +
   `weekNumber` from the date column.
5. **`assessment_criteria` (52k)**, **`assessments` (26k)** — pre-load
   assessments.csv and back-fill the missing fields.

A pass 3 would tackle the finance chain (`payments`, `invoices`,
`payment_plans`) which all need StudentAccount cross-references.
