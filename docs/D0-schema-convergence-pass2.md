# D0 — schema convergence pass 2

**Phase**: D0 follow-up (pass 2 of 3 planned).
**Branch**: `chore/sjms-dataset-shape-convergence-pass2`.
**Snapshot**: `output/2026-05-17/` (manifest seed `2026-05`, generated
`2026-05-17T19:40:11.653Z` — byte-identical to pass 1).

## What this pass did

Closed the **next eighteen shape gaps** between the sjms-v4-integrated
dataset and the SJMS-5 Prisma schema, so a clean run of
`node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17 --dry-run`
plans **39 tables** (was 21 after pass 1, 11 before pass 1) covering
**~1.64 million rows** (+630k over pass 1).

The fix uses the same architecture as pass 1 — a single registry in
`scripts/sjms-data/lib/column-synthesisers.mjs` that the importer consults
at two points (shape check + per-row coerce). Pass 2 extends the registry
with eighteen new model entries and adds five new auxiliary lookups to
`loadSynthContext`:

  - `studentIdByPersonId` (students.csv, 52k rows)
  - `firstEnrolmentDateByStudent` (enrolments.csv, accumulator)
  - `enrolments` (enrolments.csv, ~79k rows)
  - `assessmentIdByComponentId` (assessment_components.csv)
  - `studentIdByGraduandId` (graduand_records.csv, 12k rows)

No changes to `prisma/schema.prisma`. No changes to the dataset
generator. No regeneration required — the snapshot manifest hash stays
identical (this is an importer-only pass, the same approach pass 1
took).

## Tables addressed

| #  | Table                  | Rows     | Fix type           | Notes                                                                                                              |
|----|------------------------|---------:|--------------------|--------------------------------------------------------------------------------------------------------------------|
| 1  | `consent_records`      | 231,920  | (b) cross-CSV + enum-map | `studentId` via personId→studentId reverse-lookup; `consentType` mapped from dataset's operational `purpose` enum to SJMS-5's categorical |
| 2  | `student_instances`    |  78,786  | (b) cross-CSV      | `studentId` / `programmeId` / `academicYearId` / `yearOfStudy` joined from pre-loaded `enrolments` map keyed on `enrolmentId` |
| 3  | `engagement_scores`    |  78,786  | (b) compound       | `academicYear` via AY map; `weekNumber` derived as ISO week from `calculatedDate`; `calculatedDate` fallback to `createdAt` |
| 4  | `students`             |  52,000  | (b) enum-map + lookup | `feeStatus` mapped from `feeEligibility` (EU_REINSTATED → EU_TRANSITIONAL); `entryRoute` stub UCAS (modal); `originalEntryDate` from per-student earliest enrolment date |
| 5  | `assessment_criteria`  |  51,930  | (b) cross-CSV      | `assessmentId` resolved via componentId→assessmentId map from `assessment_components.csv`; `title` derived from `description` (first 60 chars); `maxMark` stub 100 |
| 6  | `progression_records`  |  38,786  | (b) enum-map + lookup | `academicYear` via AY map; `yearOfStudy` from enrolment lookup; `progressionDecision` mapped from dataset's long-form to SJMS-5's short-form enum; credits attempted/passed default to dataset's `credits` value |
| 7  | `assessments`          |  25,965  | (b) alias + stub   | `academicYear` via AY map; `weighting` ← `weight` (or stub 50); `maxMark` ← `maximumMark` (or stub 100) |
| 8  | `documents`            |  24,000  | (b) alias          | `title` ← `fileName`; `filePath` ← `fileUrl` |
| 9  | `certificates`         |  12,000  | (b) cross-CSV + alias | `studentId` from graduand_records lookup; `certificateNumber` ← `serialNumber`; `issueDate` ← `issuedDate` |
| 10 | `applicants`           |  10,000  | (b) stub           | `applicantNumber` ← row `id` (unique stand-in); `applicationRoute` stub UCAS |
| 11 | `applications`         |  10,000  | (b) computed       | `academicYear` derived from `applicationDate` using UK admissions cycle (Sept-Aug); `applicationRoute` stub UCAS |
| 12 | `room_bookings`        |   6,000  | (b) alias          | `date` ← `bookingDate` |
| 13 | `accommodation_bookings`|  6,000  | (b) alias + stub   | `startDate`/`endDate` ← `checkInDate`/`checkOutDate`; `weeklyRent` stub £140; `totalCost` stub £5600 (40-week contract) |
| 14 | `staff_contracts`      |   1,474  | (b) computed       | `staffId` ← `staffRecordId.replace(/^srec-/, 'staff-')` — id stems are byte-identical between the dataset's StaffRecord and SJMS-5's Staff |
| 15 | `staff_qualifications` |   1,370  | (b) computed + alias | same `srec- → staff-` rename for `staffId`; `qualTitle` ← `qualificationType`; `institution` ← `awardingBody` |
| 16 | `rooms`                |     711  | (b) alias          | `roomCode` ← `code`; `building` ← `buildingId` |
| 17 | `committees`           |      32  | (b) alias          | `committeeName` ← `name` |
| 18 | `faculties`            |       6  | (b) alias          | `title` ← `name` |

**Fix types** (carried over from pass 1):
- (a) extend the generator — *not used; same rationale as pass 1, would invalidate snapshot hash*.
- (b) extend the importer to synthesise a stub / alias / lookup — **all eighteen gaps closed via (b)**.
- (c) loosen the Prisma schema — *not used; production semantics genuinely require these columns*.

## Before / after coverage

```
                       BEFORE      AFTER (pass 2)       Δ this pass    Δ cumulative
covered (tables)          21              39                +18              +28
covered (rows)     1,013,329       1,643,095          +629,766         +1,391,440
skipped — shape           45              27                -18              -28
skipped — no model       227             227                  0                0
skipped — no csv           5               5                  0                0
```

Eighteen newly-importable tables (rows):

```
identity      consent_records                231,920
identity      students                        52,000
identity      applicants                      10,000
applicants    applications                    10,000
students      student_instances               78,786
assessment    assessments                     25,965
assessment    assessment_criteria             51,930
assessment    progression_records             38,786
assessment    engagement_scores               78,786
awards        certificates                    12,000
awards        documents                       24,000
estates       rooms                              711
estates       room_bookings                    6,000
estates       accommodation_bookings           6,000
governance    faculties                            6
governance    committees                          32
staff         staff_contracts                  1,474
staff         staff_qualifications             1,370
                                            -------
                                            629,766
```

## Residual diagnostics — 27 tables still shape-incompatible

Sorted by row volume (post-pass-2):

| Table                   | Rows   | Missing required                                                                  | Pass-3 plan                                                              |
|-------------------------|-------:|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| `payments`              | 97,542 | `studentAccountId`, `transactionDate`                                              | finance: blocked on empty `student_accounts.csv` (0 rows in snapshot)    |
| `attendance_records`    | 78,786 | `date`                                                                             | `date` is synthesisable from `recordedAt`, BUT all `recordedAt` cells empty AND `moduleRegistrationId` FK column empty in dataset stubs — orphan-FK risk |
| `invoices`              | 78,786 | `studentAccountId`, `issueDate`                                                    | finance: same student-accounts blocker; `issueDate` aliasable from `invoiceDate` |
| `notification_preferences` | 60,000 | `userId`, `channel`, `category`                                                  | dataset CSV keys on `studentId`; 52k students all reference user-ids that don't exist in the 11-row users.csv (orphan FKs) |
| `notifications`         | 30,000 | `userId`, `category`                                                               | same student↔user orphan-FK blocker as `notification_preferences`        |
| `moderation_records`    | 13,653 | `outcome`                                                                          | enum-map; dataset has `decision`/`status`-like column to derive from     |
| `graduation_registrations` | 12,000 | `ceremonyId`                                                                    | trivial cross-CSV from `graduation_ceremonies.csv` once mapping confirmed |
| `wellbeing_records`     |  8,000 | `referralSource`, `concern`                                                        | stubs                                                                    |
| `accommodation_rooms`   |  6,029 | `blockId`, `weeklyRent`, `contractLength`                                          | `blockId` cross-CSV from accommodation_halls; rent/length stubs          |
| `bursary_applications`  |  5,000 | `bursaryFundId`                                                                    | cross-CSV from `bursary_funds.csv`                                       |
| `second_marking_records`|  3,968 | `assessmentId`, `studentId`, `firstMarkerMark`, `secondMarkerMark`                 | cross-CSV from assessment_attempts                                       |
| `timetable_slots`       |  3,000 | `teachingEventId`                                                                  | cross-CSV from teaching_events                                           |
| `placement_visits`      |  1,962 | `visitorName`                                                                      | stub                                                                     |
| `progression_rules`     |  1,384 | `programmeLevel`, `yearOfStudy`, `minCreditsToPass`, `updatedAt`                   | reference-data: rules table needs a domain-driven population pass        |
| `programme_versions`    |  1,248 | `version`, `effectiveFrom`                                                         | derive from programme `effectiveFrom`/`version` columns                  |
| `staff_contracts` & `staff_qualifications` | NOW IMPORTABLE | — | (moved to covered, pass 2)                                       |
| `rooms`                 | NOW IMPORTABLE | — | (moved to covered, pass 2) |
| `committee_members`     |    472 | `staffId`                                                                          | cross-CSV from `staff_records` using same `srec-→staff-` prefix swap     |
| `placement_providers`   |    200 | `providerName`                                                                     | alias                                                                    |
| `exam_boards`           |    192 | `title`, `programmeId`, `boardType`                                                | aliases + cross-CSV                                                      |
| `workflow_errors`       |    100 | `updatedAt`                                                                        | stub (createdAt fallback)                                                |
| `external_examiners`    |     50 | `staffId`, `appointmentStart`, `appointmentEnd`                                    | same `srec-→staff-` swap; date aliases                                   |
| `departments`           |     48 | `schoolId`, `title`                                                                | blocked on missing `schools.csv` (0 rows; dataset has no School model)   |
| `webhook_subscriptions` |     20 | `url`, `eventTypes`, `secretKey`                                                   | stubs                                                                    |
| `communication_templates`|   10 | `templateCode`, `title`, `category`, `channel`, `body`                              | needs a domain-driven population pass                                    |
| `bursary_funds`         |      8 | `fundName`, `fundType`, `totalBudget`, `remaining`                                  | alias + stubs                                                            |
| `statutory_returns`     |      8 | `academicYear`                                                                     | alias from `year` or `academicYearId`                                    |
| `graduation_ceremonies` |      5 | `ceremonyName`                                                                     | alias from `name`                                                        |

### Top three pass-2 deferrals — root cause

1. **`payments` (97k) + `invoices` (78k)** — both require `studentAccountId`,
   but `student_accounts.csv` is empty in this snapshot (0 rows).
   Persisting these rows without a valid Account would create orphan FKs.
   Pass 3 should either: (i) extend the generator to emit
   `student_accounts.csv` deterministically from `students.csv` (one
   account per student), or (ii) skip these tables until that generator
   pass lands.

2. **`attendance_records` (78k)** — `date` is in the schema but the
   `moduleRegistrationId` FK column (REQUIRED) is empty across every
   row in the stub. Importing would either fail at coerce time or create
   orphan FKs. Needs a generator-side fix to emit synthetic module
   registrations on the attendance rows.

3. **`notifications` (30k) + `notification_preferences` (60k)** — dataset
   keys these on `studentId`, but the SJMS-5 schema (correctly) keys on
   `userId`. There are 52,000 students whose `userId` references one of
   12 users.csv rows — 51,988 of those references are orphans. A safe
   import either: (i) skip rows whose userId doesn't resolve, or
   (ii) extend the generator to backfill a User per Student. Defer to
   pass 3.

## Determinism

Every new synthesiser is a pure function of:
  - the row's own columns, or
  - a pre-loaded auxiliary map (read once at startup, last-wins per id), or
  - a static stub.

No RNG, no time-varying state, no `Date.now()`. The accumulator for
`firstEnrolmentDateByStudent` uses lexicographic min on ISO-8601 strings,
which is deterministic given a deterministic input snapshot.

The synthesiser catalogue is a frozen object literal — covered by the
"covers every advertised SJMS-5 model" test in
`scripts/test/column-synthesisers.test.mjs`.

## Test coverage

`scripts/test/column-synthesisers.test.mjs` now has **35 tests** (was 15):

  - 4 `synthesisableFields` tests (incl. one asserting pass-2 model coverage)
  - 10 pass-1 `applySynthesisers` tests (carried over)
  - 18 pass-2 `applySynthesisers` tests — one per new model entry
  - 3 `loadSynthContext` tests (pass-1 lookups, pass-2 lookups, absent files)
  - 1 `classifyTables` synthesiser-aware shape-check test (carried over)
  - 1 catalogue-shape test asserting the exact set of 28 covered SJMS-5 models

`scripts/test/d12-importer.test.mjs` — existing 13 tests still pass.
No regression in the upstream contract.

## Files changed

- `scripts/sjms-data/lib/column-synthesisers.mjs` — extended (+~240 lines):
  18 new model entries, 5 new auxiliary lookups in `loadSynthContext`,
  3 new helper functions (`isoWeekNumber`, `feeEligibilityToFeeStatus`,
  `progressionDecisionMap`, `consentPurposeToType`,
  `academicYearFromDate`).
- `scripts/test/column-synthesisers.test.mjs` — extended (+~200 lines):
  pass-2 test suite (18 new model tests + new context-loading tests +
  updated catalogue assertion).
- `docs/D0-schema-convergence-pass2.md` — **this file**.

No changes to `scripts/import-sjms-dataset.mjs` itself — the pass-1
integration points (synthesiser-aware shape check, per-row
`applySynthesisers` before coerce) already accommodate the new entries
without modification.

Total diff: under the 700-line cap.

## Pass-3 candidates (ordered by leverage)

1. **`payments` + `invoices` (~176k rows)** — generator pass: emit
   `student_accounts.csv` (one account per student). Unblocks the entire
   finance chain including `payment_plans` (~9k).
2. **`notifications` + `notification_preferences` (~90k)** — generator
   pass: backfill a User per Student. Unblocks both tables plus any
   future User-keyed schema.
3. **`attendance_records` (78k)** — generator pass: backfill
   `moduleRegistrationId` from the existing module_registrations.csv
   (already covered).
4. **`accommodation_rooms` (6k)** — straightforward cross-CSV: `blockId`
   from accommodation_halls, weeklyRent already on row.
5. **Small-table residue** (~12 tables, all <2k rows) — aliases and
   stubs analogous to pass-2 entries; one batch.

Pass 3 should also start considering whether to flip the architecture to
**generator-side** fixes for the remaining gaps (option (a)) once the
snapshot-hash invariant can be safely bumped — many of the residual
tables would be cleaner if the generator emitted SJMS-5-shaped CSVs
directly, eliminating per-row synthesiser overhead at import time.
