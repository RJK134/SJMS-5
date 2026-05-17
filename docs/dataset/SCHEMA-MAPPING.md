# SJMS-5 Synthetic Dataset — Schema Mapping (D0)

> **Phase:** D0 — Stabilise schema mapping
> **Status:** Draft for operator review
> **Source schema:** `RJK134/sjms-v4-integrated/prisma/schema.prisma` @ HEAD
> **Date:** 2026-05-17
> **Next phase:** D1 — generator skeleton + 199 empty CSVs

This document is the load-bearing contract for every subsequent phase
(D1 through D13) of the SJMS-5 synthetic dataset build. It records:

1. The **actual model inventory** in the target schema (with material
   differences from the May 2026 build brief).
2. The **domain grouping** the generator's directory layout follows.
3. The **topological generation order** the driver script enforces.
4. The **governance + finance coverage gap** between the brief and the
   schema — this is the gate for D2 and D3 and requires operator
   resolution before either phase opens.

---

## 1. Schema reality

The v4-integrated schema has **298 models**, not 199 as the May 2026
brief and the synthesis plan state. The count has grown since both
documents were written. The full enumeration is captured in
[`docs/dataset/MODELS.txt`](./MODELS.txt).

The synthesis plan ([`docs/SJMS-5-SYNTHESIS-PLAN.md`](../SJMS-5-SYNTHESIS-PLAN.md)
§4.3) further proposes that SJMS-5's actual Phase 0 import will *add*
~22 finance + assessment ledger entities from SJMS-2.5 (FeeAssessment,
ChargeLine, StudentAccount, PaymentPlan, PaymentInstalment, CreditNote,
SponsorAgreement, RefundApproval, ClearanceCheck, Award, AwardRecord,
Classification, ProgressionRule, ClassificationRule, Transcript,
TranscriptLine, AnonymousMarkingAllocation, SecondMarkingAllocation,
ExamBoardDecision, plus the Phase 17D/E classification rules). Those
additions **have not yet landed in any readable schema** — SJMS-2.5 is
not cloned in this environment, and SJMS-5 itself is empty (no Prisma
schema committed).

**Operating decision:** the dataset generator targets the v4-integrated
schema *as it stands* (298 models). When SJMS-5 Phase 0 lands and the
SJMS-5 schema materialises, the generator gets a small extension PR to
cover the 2.5 net-additive models. Treating v4-integrated as the
authority avoids a chicken-and-egg dependency on Phase 0 and lets the
dataset work proceed in parallel.

## 2. Domain grouping

The 298 models partition into **12 generator domains**. The directory
layout the brief sketches (`scripts/sjms-data/generators/<domain>.mjs`)
adopts these names. Where the brief expected a domain that the schema
does not support, the row is marked **NOT IN SCHEMA** and the
corresponding generator file is not created in D1.

| # | Domain | Generator file | Model count | Notes |
|---|---|---|---:|---|
| 1 | identity | `identity.mjs` | 27 | User, Role, Permission, RolePermission, UserRole, Session, ApiKey, Person, PersonName, ContactMethod, PersonAddress, AddressUsage, PersonNationality, Citizenship, ResidencyStatus, EmergencyContact, IdentityDocument, SensitiveAttribute, ConsentRecord, LawfulBasisRecord, TenantConfiguration, SystemConfiguration, plus 5 cross-cutting lookup tables |
| 2 | reference | `reference.mjs` | 14 | AcademicYear, HesaCostCentre, HesaHecosCode, HesaSocCode, HesaCodingFrame, HesaCodingFrameVersion, HesaQualificationAim, HesaReasonForEndingLookup, HesaQualityRule, HesaStaffContractLevel, HesaSessionYear, plus 3 calendar/lookup tables. Generated first (no FKs). |
| 3 | estates | `estates.mjs` | 5 | Campus, Building, Room, AccommodationHall, AccommodationRoom |
| 4 | governance | `governance.mjs` | 9 | Faculty, Department, DepartmentCostCentre (junction), Committee, CommitteeMember, CommitteeMeeting, CommitteeActionItem, StudentOrganisation, StudentOrgMembership, StudentOrgEvent. **See §4 for the gap vs the brief's expected governance scaffolding.** |
| 5 | staff | `staff.mjs` | 6 | Staff, StaffRecord, StaffContract, StaffQualification, ExternalExaminer, ExternalExaminerAppointment. **The brief's PayrollLine / PayGradeStepHistory do not exist — staff finance is contract-level only.** |
| 6 | curriculum | `curriculum.mjs` | 28 | Programme, ProgrammeSpecification, ProgrammeVersion, ProgrammeStageModule, ProgrammeExitAward, ProgrammeContactHours, ProgrammeLearningOutcome, ProgrammeDeclaration, PSRBAccreditation, ProgressionRule, Module, ModuleSpecification, ModuleVersion, ModuleLearningOutcome, ModuleAssessmentComponent, ProposedModule, ProposedLearningOutcome, CurriculumProposal, CurriculumStageHistory, CurriculumApprovalGate, CurriculumComment, CurriculumDocument, CurriculumMap, CurriculumWorkflow, WorkflowStage, ValidationPanelMember, ApprovalCondition, ILOModuleMapping, AssessmentOutcomeMapping |
| 7 | applicants | `applicants.mjs` | 16 | Applicant, Application, ApplicantQualification, EntryRequirement, TariffCalculation, Offer, PersonalStatement, Reference, InterviewSchedule, UcasApplication, UcasImportLog, ClearingApplication, Prospect, ProspectInteraction, RecruitmentCampaign, RecruitmentEvent |
| 8 | students | `students.mjs` | 22 | Student, StudentStatusHistory, Enrolment, ModuleRegistration, EnrolmentWorkflow, EnrolmentWorkflowStage, ApprenticeshipRegistration, ApprenticeshipEmployer, ApprenticeshipOtjRecord, ApprenticeshipGateway, ApprenticeshipEpa, StudyAim, StudentInstance, ProgrammeOccurrence, InstancePeriod, EnrolmentOccurrence, ModeOfStudyHistory, InterruptionEvent, TransferEvent, CompletionEvent, WithdrawalEvent, PersonalTutorAllocation, TutorAssignment, TutoringMeeting, StaffModuleAssignment |
| 9 | assessment | `assessment.mjs` | 29 | Assessment, AssessmentComponent, AssessmentCriteria, AssessmentSubmission, Mark, ModerationRecord, ExternalExaminerReport, AnonymousMarking, TurnitinSubmission, PlagiarismCase, AppealRecord, MitigatingCircumstance, ExamBoard, ExamBoardDecision, ProgressionRecord, AssessmentAttempt, MarkerDecision, ModerationDecisionV2, ExternalReviewDecision, BoardOutcome, ResultRelease, CalculationAudit, ReassessmentRecord, DeferralRecord, ECOutcome, ModerationSampleRecord, SecondMarkingRecord, CondonementRecord, plus engagement/attendance: AttendanceSession, AttendanceRecord, AbsenceRecord, EngagementScore, EngagementAlert, EngagementIntervention, RetentionRiskScore, RetentionIntervention, RetentionHistoricalScore, NeedsAssessment, ExamAdjustment |
| 10 | awards | `awards.mjs` | 7 | GraduationCohort, GraduationRegistration, GraduandRecord, DegreeAward, Transcript, Certificate, GraduationCeremony, plus DocumentTemplate, DocumentGeneration, GeneratedDocument, BatchDocumentGeneration, Document, DocumentPermission, DocumentSharePointMapping, SharePointGroupMapping, PermissionSyncLog |
| 11 | finance-student | `finance-student.mjs` | 16 | Fee, Invoice, Payment, PaymentTransaction, PaymentPlan, SponsorRecord, SponsorPayment, BursaryFund, BursaryApplication, FundingApplication, Debt, Refund, SlcLoan, SlcPaymentNotification, SlcFeeAssessment, ApprenticeshipFundingClaim. **No ChargeLine, StudentAccount, PaymentAllocation, JournalEntry, NominalCode, GLAccount, BudgetLine — see §4.** |
| 12 | welfare, placements, pgr, comms, research, regulatory, gdpr, misc | `…` (8 files) | ~120 | See [`docs/dataset/MODEL-DOMAIN-MAP.md`](./MODEL-DOMAIN-MAP.md) for the per-model assignment. These domains carry the long tail and are generated after the academic spine. |

Total domains active in D1: **12**. The brief's `finance-chart`,
`finance-budgets`, `finance-research`, `finance-journal`, and `library`
domains have no schema support and are not created.

## 3. Topological generation order

The driver in `scripts/generate-synthetic-dataset.mjs` (D1) sequences
generators in this order. Each layer's FKs only point at preceding
layers.

```
identity        ── User, Person, Role, Permission, Tenant config
   ↓
reference       ── AcademicYear, HesaCostCentre, HECOS, SOC codes
   ↓
estates         ── Campus, Building, Room, AccommodationHall, AccommodationRoom
   ↓
governance      ── Faculty, Department, DepartmentCostCentre, Committee
   ↓
staff           ── Staff, StaffRecord, StaffContract, StaffQualification
   ↓
curriculum      ── Programme, Module, ProgrammeVersion, ModuleVersion, ILOs
   ↓
applicants      ── Prospect, Applicant, Application, Offer, UcasApplication
   ↓
students        ── Student, Enrolment, ModuleRegistration, StudentInstance
   ↓
assessment      ── Assessment, Mark, ModerationRecord, ExamBoard, attendance
   ↓
awards          ── GraduationCohort, DegreeAward, Transcript, Certificate, docs
   ↓
finance-student ── Fee, Invoice, Payment, SponsorRecord, BursaryFund, Refund
   ↓
welfare         ── SupportTicket, MisconductCase, DisabilityAdjustment
   ↓
placements      ── StudentPlacement, GraduateOutcome, AlumniRecord
   ↓
pgr             ── PgrRegistration, PgrSupervisor, PgrMilestone, PgrThesis
   ↓
research        ── RefSubmission, RefOutput, RefImpactCase, KefMetric
   ↓
comms           ── CommunicationTemplate, Notification, StudentCommunication
   ↓
regulatory      ── HesaReturn, HesaLearner, OfsCondition, VisaRecord, CasRecord
   ↓
gdpr-audit      ── RetentionPolicy, DataSubjectRequest, AuditLog
   ↓
misc            ── Survey, SelfServiceRequest, Webhook, AI, Moodle logs
```

The ordering diverges from the brief at two points:

- **`reference` runs before `estates`** because HesaCostCentre is a
  precondition for DepartmentCostCentre in `governance`.
- **`finance-student` runs after `awards`** rather than between
  `students` and `assessment`, because Fee.enrolmentId already exists
  by then and the brief's intermediate finance-budgets / finance-journal
  domains are absent.

No cycles in the FK graph. No back-edges that require
forward-reference patching in the generator.

## 4. Governance + finance coverage gap — STOP-gate question

The brief specifies governance and finance scaffolding the schema does
not support. This is a **STOP-gate** per
[operating model §6](../SJMS-5-OPERATING-MODEL.md): schema mutation
requires an approved design doc before code lands, and the brief
itself forbids schema changes ("DO NOT mutate the SJMS-5 Prisma
schema"). The two directives need operator reconciliation before D2
opens.

### 4.1 Governance — brief expectation vs schema reality

| Brief expects | Schema has | Verdict |
|---|---|---|
| OrganisationUnit + OrgUnitHierarchy (4-tier tree) | Faculty → Department (2-tier flat) | **NOT IN SCHEMA** — only Faculty + Department exist; no School / ResearchCentre / Institute tier |
| Faculty (4 — Arts, Science, Health, Business) | Faculty (`facultyType` not present; v4 seed uses 6 — Arts, Science, Health, Business, Social Sciences, Creative) | Partial — emit 6 faculties matching the seed, not the brief's 4 |
| School (~16) | — | **NOT IN SCHEMA** |
| Department (~48) | Department, FK to Faculty | OK — emit 6 × 8 = 48 departments scaled up from the seed's 30 |
| ResearchCentre (~30, Director + Steering Group) | — | **NOT IN SCHEMA** |
| Council, Senate, ExecutiveBoard, FacultyBoard, StandingCommittee | Single polymorphic `Committee` model with `committeeType` enum (ACADEMIC_BOARD, SENATE, FACULTY_BOARD, LEARNING_TEACHING, QUALITY_ASSURANCE, RESEARCH, EXAM_BOARD, FINANCE, HEALTH_SAFETY, EQUALITY_DIVERSITY, STUDENT_EXPERIENCE, PROGRAMME_BOARD) | **Adapted** — encode all governance bodies as Committee instances. Council/ExecutiveBoard need adding to the enum (one-line change) or modelled as ACADEMIC_BOARD variants. |
| GovernanceRole, Chair, ExecOffice | — (Committee has `chairName`/`chairEmail` as text) | **NOT IN SCHEMA** |
| CommitteeMembership (~400 rows) | CommitteeMember | OK — emit ~400 |
| Dean / HoS / HoD reporting chain (tree, no cycles) | Faculty.headOfFaculty + Department.headOfDepartment as free-text strings, no FK to Staff/Person | Weak — emit but with no enforceable tree integrity at schema level |

### 4.2 Finance — brief expectation vs schema reality

| Brief expects | Schema has | Verdict |
|---|---|---|
| CostCentre (130-row tree mirroring governance) | HesaCostCentre (~40 HESA-standard codes only) + DepartmentCostCentre (junction) | **Adapted** — emit standard HESA cost centres + dept linkage |
| NominalCode (~200 JISC FSSG codes) | — | **NOT IN SCHEMA** |
| FundCode (~10 — unrestricted/restricted/endowed) | — | **NOT IN SCHEMA** |
| GLAccount (~3,000 sparse CostCentre × NominalCode × FundCode tuples) | — | **NOT IN SCHEMA** |
| ChartOfAccounts | — | **NOT IN SCHEMA** |
| Budget + BudgetLine + Forecast (~12,000 rows, 4 years) | — | **NOT IN SCHEMA** |
| BudgetCycle | — | **NOT IN SCHEMA** |
| StudentAccount (40,000 rows, net position per student) | — | **NOT IN SCHEMA** (synthesis plan adds this in Phase 0 from SJMS-2.5) |
| FeeAssessment (~80,000, one per student-year) | Fee (analogue; row per fee event, not per student-year) | **Adapted** — emit Fee rows scoped to one per (student × academic year × feeType) |
| Invoice + ChargeLine (~80k + ~240k) | Invoice (no ChargeLine — Invoice.totalAmount is flat) | **Adapted** — emit Invoice only, no line breakdown |
| PaymentAllocation (~200k) | — (Payment.feeId is direct FK, no allocation join) | **NOT IN SCHEMA** |
| Sponsor / Bursary / Refund | SponsorRecord, SponsorPayment, BursaryFund, BursaryApplication, Refund | OK |
| Grant (~200 active grants) | — | **NOT IN SCHEMA** |
| ProjectCode | — | **NOT IN SCHEMA** |
| GrantClaim / GrantExpenditure | — | **NOT IN SCHEMA** |
| ResearchAccount | — | **NOT IN SCHEMA** |
| JournalEntry (~500,000 balanced Dr/Cr pairs) | — | **NOT IN SCHEMA** |
| Contract (~1,200 staff contracts) | StaffContract | OK |
| PayrollLine (~60,000 monthly payroll rows) | — | **NOT IN SCHEMA** |
| PayGradeStepHistory | — | **NOT IN SCHEMA** |
| FundAllocation | — | **NOT IN SCHEMA** |

### 4.3 Recommended resolution

Three options, in increasing scope:

**Option A — generate only what the schema supports (recommended).**
D2 emits the 9-model governance set as adapted in §4.1. D3 is dropped
(no finance-chart to seed). D7 emits the 16-model finance-student set
without ChargeLine / StudentAccount / JournalEntry. D8 collapses to
StaffContract-only; D9, D10, D12 (finance-journal) are dropped. Net
phase count drops from D0–D13 to D0–D11. Generator ships realistic
data for everything the schema persists; brief's chart-of-accounts
ambition is recorded as a follow-on for when the schema acquires those
models (likely Phase 0 spine import + a Phase 1 extension).

**Option B — extend the schema, then generate.** Open a STOP-gated
design doc proposing the missing 18+ governance + finance models
(OrganisationUnit, OrgUnitHierarchy, NominalCode, FundCode, GLAccount,
Budget, BudgetLine, JournalEntry, Grant, PayrollLine, etc.). Operator
sign-off required. Adds ~2 weeks before D2 can open. Pre-empts and
makes redundant part of what SJMS-2.5's Phase 18 finance work is
already developing.

**Option C — wait for SJMS-5 Phase 0 to land first.** Phase 0 imports
the 2.5 spine and produces the canonical SJMS-5 schema, which the
synthesis plan says will already include StudentAccount, ChargeLine,
PaymentInstalment, etc. The remaining gap (governance scaffolding,
chart-of-accounts, journals) is then resolved against the actual
target rather than against v4-integrated. Defers the dataset work by
the duration of Phase 0.

**Recommendation: Option A.** It lets the dataset work proceed now,
ships value against the schema that actually exists, and leaves the
expanded ambitions as a documented follow-on rather than a
multi-week prerequisite. Updating the brief's D2/D3/D7-D10 phase
scopes accordingly is the operator decision being asked for.

## 5. Seed scripts to port (D2)

Per the brief's "PORT THEM FIRST" rule, the v4-integrated seed scripts
that already produce opinionated governance reference data:

- [`prisma/seed.ts`](../../../sjms-v4-integrated/prisma/seed.ts) (1309
  lines) — "Future Horizons University" comprehensive seed: 6 faculties,
  30 departments, 60 programmes, 600 modules, 500 students. Uses a
  `SeededRandom` class identical in pattern to the one the generator
  will use.
- [`scripts/seed.ts`](../../../sjms-v4-integrated/scripts/seed.ts)
  (698 lines) — richer faculty/department skeleton with HECOS subject
  codes. **This is the canonical governance reference data — port the
  FACULTIES constant verbatim into `lib/uk-uni-skeleton.mjs`.**

Neither seed script populates Committee, StaffContract, Fee, Invoice,
or any finance models. Those generators are built from scratch in
D2/D3/D7.

## 6. Verification (D0 acceptance)

- [x] Full model list extracted (298 models) → `docs/dataset/MODELS.txt`
- [x] Models grouped into 12 domains → §2
- [x] Governance + finance coverage explicitly tabulated → §4
- [x] Topological order computed → §3
- [x] STOP-gate question raised for operator → §4.3
- [ ] Operator decision on Option A/B/C → blocks D2 opening
- [ ] Once the decision is recorded, D1 (generator skeleton) opens
      against `phase-D1/generator-skeleton` from `main`.

## 7. Environment notes for D1+

- **Node version mismatch.** This environment runs Node v18.19.1 / pnpm
  9.15.9. The synthesis plan, the Maieus2 toolchain, and the SJMS-5
  CLAUDE.md target Node 20 / pnpm 10. Resolve before D1 (`nvm install
  20; npm i -g pnpm@10`) — D1 needs `pnpm install` and the generator
  needs ESM module loading semantics that differ subtly between 18 and
  20.
- **rclone `gdrive5tb:` remote** is configured locally — D12's sync
  step works without further setup.
- **Git identity** at the SJMS-5 repo level: set to
  `richardknapp134@gmail.com` / `Richard Knapp` during this branch's
  creation.
