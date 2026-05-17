# SJMS-5 Synthetic Dataset — Stats Snapshot

> Captured: 2026-05-17 (seed `2026-05`)
> Source schema: `RJK134/sjms-v4-integrated/prisma/schema.prisma` @ HEAD
> Schema hash: `de47e71164350a337c06a14dde3ff13e983b114c307e79445907fa76f3db1a0e`

Headline:

| Metric | Value |
|---|---:|
| Tables generated | 298 / 298 (100% coverage) |
| Total rows | **5,292,376** |
| Disk size | ~824 MB |
| Generation time | ~55 s (single-threaded Node 18) |
| Determinism | Byte-identical across reruns at fixed seed |

## Headline cohort

| Cohort | Count | Notes |
|---|---:|---|
| Students | 52,000 | 40,000 active (AY 2025/26) + 12,000 alumni |
| Applicants | 10,000 | Cycle 2026/27, 80% offers, 12% via clearing |
| Staff | 980 | 6 Deans + 48 HoDs + 576 academic + 350 PS |
| Persons (total) | 62,980 | Students + staff + applicants + system users |
| External Examiners | 50 | From 20 peer institutions |
| Active Programmes | 625 | Across 48 departments, 6 faculties |
| Modules | 3,360 | ~70 per department, FHEQ 3–8 |
| ModuleRegistrations | 426,966 | 5–6 per enrolment-year |
| AssessmentSubmissions | 134,638 | 2 per enrolment for non-PGR |
| Fees (tuition) | 78,786 | One per enrolment with level-aware pricing |
| Payments | 97,542 | Mix of instalment + SLC + sponsor + apprenticeship |
| SLC loans | 31,648 | UK undergrads on SLC funding |
| GraduandRecords | 12,000 | Across 5 graduation cohorts |

## Per-domain breakdown

| Domain | Models | Rows |
|---|---:|---:|
| identity (incl. Person family) | 27 | 752,931 |
| reference | 14 | 248 |
| estates | 5 | 6,773 |
| governance | 11 | 32,489 |
| staff | 6 | 4,855 |
| curriculum | 32 | 53,795 |
| applicants | 16 | 161,070 |
| students | 25 | 920,540 |
| assessment | 39 | 793,816 |
| awards | 15 | 124,545 |
| finance-student | 16 | 422,977 |
| longtail | 92 | 2,019,337 |
| **Total** | **298** | **5,292,376** |

## Top 30 tables by row count

| Table | Rows |
|---|---:|
| module_registrations | 426,966 |
| lawful_basis_records | 283,920 |
| consent_records | 231,920 |
| tutoring_meetings | 228,219 |
| enrolment_workflow_stages | 200,000 |
| assessment_submissions | 134,638 |
| marks | 134,638 |
| assessment_attempts | 134,638 |
| contact_methods | 125,960 |
| payments | 97,542 |
| payment_transactions | 97,542 |
| slc_payment_notifications | 94,941 |
| student_status_history | 78,786 |
| enrolments | 78,786 |
| student_instances | 78,786 |
| instance_periods | 78,786 |
| enrolment_occurrences | 78,786 |
| personal_tutor_allocations | 78,786 |
| tutor_assignments | 78,786 |
| exam_board_decisions | 78,786 |
| attendance_records | 78,786 |
| engagement_scores | 78,786 |
| retention_risk_scores | 78,786 |
| fees | 78,786 |
| invoices | 78,786 |
| prospect_interactions | 75,417 |
| persons | 62,980 |
| person_names | 62,980 |
| person_addresses | 62,980 |
| address_usages | 62,980 |

See `docs/dataset/manifest-2026-05-17.json` for the full row-count
breakdown across all 298 tables.

## Realism notes

- **Demographics** drawn from HESA SEXID / ETHNIC / DISABLE distributions
  (2022/23 returns), DOMICILE per the typical post-92 mix (~75% UK).
- **POLAR4 quintiles** reflect a balanced widening-participation institution.
- **Marks** drawn from N(58, 14) clamped to [0, 100] — UK HE typical with
  mode at 2:1 and ~10% module-level fail rate.
- **Classification distribution**: 25% First, 50% 2:1, 22% 2:2, 4% Third,
  1% Pass — within DfE thresholds for grade-inflation reporting.
- **HECOS codes** cover every FHU department per the HESA HECOS register.
- **UCAS tariff** uses real-world points (A* = 56, A = 48, ...).
- **Fee bands**: £9,250 home UG, £11,500 home PGT, £16,000 overseas,
  £5,000 PGR — UK 2024/25 indicative levels.
- **UCEA pay spine**: 9-grade structure mapped to spine points 1–51 plus
  the unscaled professorial range.

See `lib/uk-demographics.mjs` for every distribution with its source.

## Excluded (per SJMS-vs-ERP scope rule — see SCHEMA-MAPPING.md §3)

These models belong in Finance/HR/RIS systems, not in an SJMS, and so
are not generated:

- General ledger: `NominalCode`, `FundCode`, `GLAccount`, `ChartOfAccounts`,
  `Budget`, `BudgetLine`, `BudgetCycle`, `Forecast`, `JournalEntry`
- Payroll execution: `PayrollLine`, `PayGradeStepHistory`, `FundAllocation`
- Grant accounting: `Grant`, `ProjectCode`, `ResearchAccount`,
  `GrantClaim`, `GrantExpenditure`
- Fragmented governance: `Council`, `Senate`, `GovernanceRole`, `Chair`,
  `ExecOffice`, `School`, `ResearchCentre` (covered by polymorphic
  `Committee.committeeType` per v4 schema)

`OrganisationUnit` / `OrgUnitHierarchy` is open as a Phase-1+
schema-improvement candidate (raised separately from the dataset).

## Phase 0 follow-on (KI-S5-205)

When SJMS-5 Phase 0 spine import lands and produces the SJMS-5 schema,
a small follow-on PR extends the generator to cover ~22 net-additive
2.5 ledger entities (StudentAccount, ChargeLine, PaymentAllocation,
PaymentInstalment, SponsorAgreement, RefundApproval, ClearanceCheck,
Award, AwardRecord, Classification, Transcript[new richer shape],
AnonymousMarkingAllocation, SecondMarkingAllocation, ExamBoardDecision,
ProgressionRule reconciliation, ClassificationRule). Estimated half
day's work.
