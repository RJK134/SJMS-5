# SJMS-5 Synthetic Dataset Generator

Produces a long-lived virtual UK university (~40k students, 5 years of
history) as CSV files staged on `gdrive5tb:sjms-5-dataset/`. The
imported dataset populates SJMS-5's Prisma database for Phase 0+
testing, demos, and benchmarks.

See [`../docs/dataset/SCHEMA-MAPPING.md`](../docs/dataset/SCHEMA-MAPPING.md)
for the architectural contract this generator implements.

## Quick start

```sh
# Install
pnpm install

# Generate against the default output dir
SJMS_DATASET_SEED='2026-05' pnpm generate -- --out output/2026-05-17

# Sync to the lake
rclone sync output/2026-05-17/ gdrive5tb:sjms-5-dataset/2026-05-17/
rclone sync output/2026-05-17/ gdrive5tb:sjms-5-dataset/latest/
```

## Layout

```
scripts/
  generate-synthetic-dataset.mjs   # CLI entry point + topological driver
  sjms-data/
    generators/                    # one file per active domain
      identity.mjs                 # User, Person, Role, ...
      reference.mjs                # AcademicYear, HesaCostCentre, ...
      estates.mjs                  # Campus, Building, Room, ...
      governance.mjs               # Faculty, Department, Committee, ...
      staff.mjs                    # Staff, StaffContract, ...
      curriculum.mjs               # Programme, Module, ProgrammeVersion, ...
      applicants.mjs               # Applicant, Application, Offer, UCAS, ...
      students.mjs                 # Student, Enrolment, ModuleRegistration, ...
      assessment.mjs               # Assessment, Mark, Moderation, ExamBoard
      awards.mjs                   # GraduationCohort, DegreeAward, Transcript
      finance-student.mjs          # Fee, Invoice, Payment, Sponsor, Bursary
      longtail.mjs                 # welfare, placements, PGR, research,
                                   # regulatory, GDPR, AI, VLE, misc
    lib/
      rng.mjs                      # seedrandom wrapper with .pick/.gauss
      csv-writer.mjs               # RFC 4180 + UTF-8 + LF + JSON arrays
      manifest.mjs                 # manifest.json writer
      schema.mjs                   # Prisma schema parser → model→fields
      academic-calendar.mjs        # term dates, UK FY/AY reconciliation
      uk-uni-skeleton.mjs          # 6-faculty/48-department FHE skeleton
      uk-demographics.mjs          # names, postcodes, IMD, ethnicity, ...
```

## Design principles

See [`../docs/dataset/SCHEMA-MAPPING.md`](../docs/dataset/SCHEMA-MAPPING.md)
for the full rationale.

1. **Deterministic.** Same seed = byte-identical output across reruns.
2. **Topological order.** Parents before children — driver fails if a
   generator references an unassigned model.
3. **Realistic UK demographics.** ONS / HESA / UCAS / JISC open-data
   distributions cited inline in `lib/uk-demographics.mjs`.
4. **Internally consistent.** Every student implies an application that
   resolved to an offer that became an enrolment that produced fee
   assessments.
5. **FORBIDDEN_COLUMNS.** Generator cannot produce columns matching
   `{body, question_text, mark_scheme, answer, solution, ...}` — the
   writer refuses them, not the importer.
6. **Manifest required.** Every run writes `manifest.json` with
   `{ generatedAt, seed, generatorCommit, rowCounts, schemaVersion }`.

## CLI flags

| Flag | Default | Effect |
|---|---|---|
| `--out <dir>` | `output/<today>` | Output directory |
| `--seed <str>` | env `SJMS_DATASET_SEED` or `2026-05` | RNG seed |
| `--only <domain>` | — | Run only listed domains (comma-separated) |
| `--skip <domain>` | — | Skip listed domains |
| `--dry-run` | false | Generate but don't write CSVs (useful for shape verification) |
| `--scale <n>` | `1.0` | Scale row counts by factor (0.01 = 1% sample for CI) |

## Schema version contract

The generator targets `RJK134/sjms-v4-integrated/prisma/schema.prisma`
@ HEAD (298 models as of 2026-05-17). The manifest records the schema
hash; importers refuse a snapshot whose schema hash does not match
their compiled schema.

## Continuous integration

`.github/workflows/dataset-ci.yml` runs on every PR that touches the
generator, fixtures, or tests. It executes `pnpm test` and then
generates two `--scale 0.05` snapshots from the same seed and
sha256-compares them — any divergence fails the build. This is the
guard against accidental non-determinism (a `Math.random()` slipping
in, an unsorted `Map` iteration, a `Date.now()` call, etc.).
