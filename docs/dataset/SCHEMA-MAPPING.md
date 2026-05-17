# SJMS-5 Synthetic Dataset — Schema Mapping (D0)

> **Phase:** D0 — Stabilise schema mapping
> **Status:** Decisions taken; ready for D1
> **Source schema:** `RJK134/sjms-v4-integrated/prisma/schema.prisma` @ HEAD
> **Date:** 2026-05-17
> **Next phase:** D1 — generator skeleton + 298 empty CSVs

This document is the load-bearing contract for every subsequent phase
(D1 through D11) of the SJMS-5 synthetic dataset build. It records:

1. What the dataset is **for** (§1).
2. The **actual model inventory** in the target schema (§2).
3. The **scope boundary** — what an SJMS persists and what it does
   not (§3); this collapses the brief's expanded governance + finance
   ambitions into the SJMS-vs-ERP rule.
4. The **domain grouping** the generator's directory layout follows
   (§4) and the **topological generation order** the driver enforces
   (§5).
5. The **Phase 0 follow-on plan** for the ~22 net-additive SJMS-2.5
   ledger entities that arrive with the spine import (§6).

## 1. Purpose — a virtual university, not just a Phase 0 seed

The dataset is a **long-lived virtual institution** staged on
`gdrive5tb:sjms-5-dataset/`. It is not a one-off Phase 0 seed. It
exists to:

- **Make every SJMS-5 phase testable.** v4-integrated's portals throw
  on its own seed data (KI-S5-101, KI-S5-102). SJMS-5 needs a
  substantial, internally consistent corpus the moment Phase 0 lands,
  and a refreshable one as the schema evolves through Phases 1–11.
- **Survive schema migrations.** Each schema-changing PR re-runs the
  generator against the new schema; the dated lake snapshot is the
  before/after diff. Migration safety is verified against real volume,
  not 5-row fixtures.
- **Support demos, benchmarks, training.** A persistent reference
  corpus — "Future Horizons University, ~40k students, 5 years of
  history" — that contributors, sales conversations, and CI all share
  the same picture of.
- **Surface schema improvements.** Generating realistic UK HE data
  against the v4 schema exposes places where v4's shape is awkward to
  populate honestly (free-text `headOfDepartment` instead of a Staff
  FK; flat `Invoice.totalAmount` with no line breakdown; etc.). Those
  are captured as candidate Phase-1+ schema-improvement design docs,
  separate from the dataset itself.

The dataset's lifecycle mirrors Maieus2's datalake pattern (PR #94 /
PR #99): generator writes CSVs → rclone sync to gdrive → SJMS-5's
`pnpm import-sjms-dataset` walks the manifest and upserts.

---

## 2. Schema reality

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

The dataset generator targets the v4-integrated schema *as it stands*
(298 models). When SJMS-5 Phase 0 lands and the SJMS-5 schema
materialises, a small follow-on PR extends the generator to cover the
~22 net-additive 2.5 models — see §6 for the plan. Treating
v4-integrated as the authority avoids a chicken-and-egg dependency on
Phase 0 and lets the dataset work proceed in parallel.

## 3. Scope — an SJMS, not an ERP

The May 2026 build brief expanded the dataset's reach into
chart-of-accounts, general-ledger, journal-entry, payroll, and
grant-accounting territory. **None of that belongs in an SJMS.** A
real UK university runs four or five interconnected systems:

| System | Owns | Examples |
|---|---|---|
| **SJMS / SRS** *(SJMS-5)* | Students, applications, enrolments, modules, assessments, awards, student-facing finance (fees, invoices, payments, bursaries, sponsors, refunds), HESA returns, research outputs | SITS, Banner, Quercus, Tribal |
| Finance | General ledger, chart of accounts, journal entries, accounts payable, budget framework, fixed assets, banking | Oracle EBS, Unit-e, Tribal Sapphire |
| HR / Payroll | Staff master record, contracts at HR level, payroll execution, pension contributions, grade-step progression | iTrent, Oracle HCM, ResourceLink |
| Research Information | Grant accounting, project codes, principal investigators, FEC, overhead recovery | Pure, Symplectic, Worktribe |

What this means for the generator:

**In scope** (the generator produces these — every model the v4 schema
defines is generated):

- Student-facing finance: `Fee`, `Invoice`, `Payment`, `PaymentPlan`,
  `SponsorRecord`, `BursaryFund`, `Refund`, plus the SLC and
  apprenticeship-funding integration surfaces. Phase 0 will add the
  richer 2.5 ledger entities (StudentAccount, ChargeLine,
  PaymentAllocation, PaymentInstalment, SponsorAgreement,
  RefundApproval, ClearanceCheck) — generator extension follows.
- Staff records at the surface SJMS holds them: `StaffRecord`,
  `StaffContract`, `StaffQualification`, `ExternalExaminer`.
- HESA-aligned cost-centre mapping: `HesaCostCentre`,
  `DepartmentCostCentre`. Used to map departmental activity onto the
  ~40 HESA cost-centre codes for FSR submission.
- Research surface: `RefSubmission`, `RefOutput`, `RefImpactCase`,
  `RefEnvironmentStatement`, `KefMetric`, `KefNarrative`.
- Governance: `Faculty`, `Department`, plus the polymorphic
  `Committee` model with `committeeType` enum (`SENATE`,
  `ACADEMIC_BOARD`, `FACULTY_BOARD`, `LEARNING_TEACHING`,
  `QUALITY_ASSURANCE`, `RESEARCH`, `EXAM_BOARD`, `FINANCE`,
  `HEALTH_SAFETY`, `EQUALITY_DIVERSITY`, `STUDENT_EXPERIENCE`,
  `PROGRAMME_BOARD`). All governance bodies — Senate, Council,
  Executive Board, Faculty Boards, standing committees — are emitted
  as `Committee` instances differentiated by `committeeType`.

**Out of scope** (would create orphan models with no schema home, no
return that consumes them, and no real-system referent):

- Finance system: `NominalCode`, `FundCode`, `GLAccount`,
  `ChartOfAccounts`, `Budget`, `BudgetLine`, `BudgetCycle`,
  `Forecast`, `JournalEntry`. SJMS-5 reconciles to the institution's
  GL via Payment events — it does not hold the GL itself.
- HR / Payroll system: `PayrollLine`, `PayGradeStepHistory`,
  `FundAllocation`. SJMS-5 holds `StaffContract` at the FTE +
  start/end-date level that HESA Staff Return needs — not the monthly
  payroll-line detail.
- RIS / Finance bridge: `Grant`, `ProjectCode`, `ResearchAccount`,
  `GrantClaim`, `GrantExpenditure`. SJMS-5 holds `RefOutput` and
  `RefImpactCase` as the REF-facing surface; the grant accounting
  itself lives in the RIS.
- Governance fragmented into separate tables: `Council`, `Senate`,
  `GovernanceRole`, `Chair`, `ExecOffice`, `School`, `Institute`,
  `ResearchCentre` as standalone models. v4's polymorphic
  `Committee.committeeType` covers the same data more cleanly; the
  brief's separate tables would be an unnecessary fragmentation.

**Schema-improvement candidate (separate Phase-1+ design doc, not a
dataset blocker):** `OrganisationUnit` + `OrgUnitHierarchy` as a
generic abstraction would let SJMS-5 model Institution → Faculty →
School → Department → ResearchCentre cleanly, support arbitrary
cost-centre rollups, and let research centres span departments. This
is a genuine improvement to v4's 2-tier flat Faculty → Department
shape. Raise as a STOP-gated design doc against SJMS-5 itself, not
against the dataset generator.

## 4. Domain grouping

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
| 4 | governance | `governance.mjs` | 9 | Faculty, Department, DepartmentCostCentre (junction), Committee, CommitteeMember, CommitteeMeeting, CommitteeActionItem, StudentOrganisation, StudentOrgMembership, StudentOrgEvent. Council / Senate / Faculty Boards / standing committees are all `Committee` instances differentiated by `committeeType` per §3. |
| 5 | staff | `staff.mjs` | 6 | Staff, StaffRecord, StaffContract, StaffQualification, ExternalExaminer, ExternalExaminerAppointment. Staff finance is contract-level only (no `PayrollLine` — that's HR/Payroll-system territory per §3). |
| 6 | curriculum | `curriculum.mjs` | 28 | Programme, ProgrammeSpecification, ProgrammeVersion, ProgrammeStageModule, ProgrammeExitAward, ProgrammeContactHours, ProgrammeLearningOutcome, ProgrammeDeclaration, PSRBAccreditation, ProgressionRule, Module, ModuleSpecification, ModuleVersion, ModuleLearningOutcome, ModuleAssessmentComponent, ProposedModule, ProposedLearningOutcome, CurriculumProposal, CurriculumStageHistory, CurriculumApprovalGate, CurriculumComment, CurriculumDocument, CurriculumMap, CurriculumWorkflow, WorkflowStage, ValidationPanelMember, ApprovalCondition, ILOModuleMapping, AssessmentOutcomeMapping |
| 7 | applicants | `applicants.mjs` | 16 | Applicant, Application, ApplicantQualification, EntryRequirement, TariffCalculation, Offer, PersonalStatement, Reference, InterviewSchedule, UcasApplication, UcasImportLog, ClearingApplication, Prospect, ProspectInteraction, RecruitmentCampaign, RecruitmentEvent |
| 8 | students | `students.mjs` | 22 | Student, StudentStatusHistory, Enrolment, ModuleRegistration, EnrolmentWorkflow, EnrolmentWorkflowStage, ApprenticeshipRegistration, ApprenticeshipEmployer, ApprenticeshipOtjRecord, ApprenticeshipGateway, ApprenticeshipEpa, StudyAim, StudentInstance, ProgrammeOccurrence, InstancePeriod, EnrolmentOccurrence, ModeOfStudyHistory, InterruptionEvent, TransferEvent, CompletionEvent, WithdrawalEvent, PersonalTutorAllocation, TutorAssignment, TutoringMeeting, StaffModuleAssignment |
| 9 | assessment | `assessment.mjs` | 29 | Assessment, AssessmentComponent, AssessmentCriteria, AssessmentSubmission, Mark, ModerationRecord, ExternalExaminerReport, AnonymousMarking, TurnitinSubmission, PlagiarismCase, AppealRecord, MitigatingCircumstance, ExamBoard, ExamBoardDecision, ProgressionRecord, AssessmentAttempt, MarkerDecision, ModerationDecisionV2, ExternalReviewDecision, BoardOutcome, ResultRelease, CalculationAudit, ReassessmentRecord, DeferralRecord, ECOutcome, ModerationSampleRecord, SecondMarkingRecord, CondonementRecord, plus engagement/attendance: AttendanceSession, AttendanceRecord, AbsenceRecord, EngagementScore, EngagementAlert, EngagementIntervention, RetentionRiskScore, RetentionIntervention, RetentionHistoricalScore, NeedsAssessment, ExamAdjustment |
| 10 | awards | `awards.mjs` | 7 | GraduationCohort, GraduationRegistration, GraduandRecord, DegreeAward, Transcript, Certificate, GraduationCeremony, plus DocumentTemplate, DocumentGeneration, GeneratedDocument, BatchDocumentGeneration, Document, DocumentPermission, DocumentSharePointMapping, SharePointGroupMapping, PermissionSyncLog |
| 11 | finance-student | `finance-student.mjs` | 16 | Fee, Invoice, Payment, PaymentTransaction, PaymentPlan, SponsorRecord, SponsorPayment, BursaryFund, BursaryApplication, FundingApplication, Debt, Refund, SlcLoan, SlcPaymentNotification, SlcFeeAssessment, ApprenticeshipFundingClaim. Phase 0 spine import will add the richer 2.5 ledger (StudentAccount, ChargeLine, PaymentAllocation, PaymentInstalment, SponsorAgreement, RefundApproval, ClearanceCheck) — see §6 for the follow-on plan. GL / journal entries / budgets are out of scope per §3. |
| 12 | welfare, placements, pgr, comms, research, regulatory, gdpr, misc | `…` (8 files) | ~120 | See [`docs/dataset/MODEL-DOMAIN-MAP.md`](./MODEL-DOMAIN-MAP.md) for the per-model assignment. These domains carry the long tail and are generated after the academic spine. |

Total domains active in D1: **12**. The brief's `finance-chart`,
`finance-budgets`, `finance-research`, `finance-journal`, and `library`
domains belong outside an SJMS per §3 and are not created.

## 5. Topological generation order

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

## 6. Phase 0 follow-on plan

Phase 0 spine import will produce the actual SJMS-5 schema by taking
v4-integrated as the base and adding ~22 net-additive ledger entities
from SJMS-2.5. The generator extends to cover them in a single
follow-on PR — estimated half-day's work — landed against the new
SJMS-5 schema once Phase 0's `0001_init` migration is committed.

**Models to add generators for** (per synthesis plan §4.3):

| Domain | New models | Notes |
|---|---|---|
| awards | Award, AwardRecord, Classification, Transcript, TranscriptLine | Extend `awards.mjs`. The existing v4 `DegreeAward` + `Transcript` overlap — reconcile in the extension PR. |
| reference | ClassificationRule, ProgressionRule (richer 2.5 versions) | Extend `reference.mjs`. v4 already has `ProgressionRule` — reconcile. |
| assessment | AnonymousMarkingAllocation, SecondMarkingAllocation, ExamBoardDecision | Extend `assessment.mjs`. v4 has `AnonymousMarking` / `SecondMarkingRecord` / `ExamBoardDecision` — likely a rename or merge. |
| finance-student | FeeAssessment, ChargeLine, StudentAccount, PaymentPlan (richer), PaymentInstalment, CreditNote, SponsorAgreement, RefundApproval, ClearanceCheck | Extend `finance-student.mjs`. The richer ledger has clear semantic differences (Invoice/Payment normalised through StudentAccount + ChargeLine; PaymentInstalment as separate row per scheduled payment); generator needs the full Fee → FeeAssessment → ChargeLine → Invoice → Payment → PaymentAllocation chain. This is the biggest extension. |

The follow-on PR is sized: ~half day. It is not on the critical path
for D1–D11 — those phases proceed against v4-integrated as it stands,
and the lake holds the v4-shaped snapshot until the post-Phase-0
re-generation runs.

## 7. Seed scripts to port (D2)

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

## 8. Verification (D0 acceptance)

- [x] Full model list extracted (298 models) → `docs/dataset/MODELS.txt`
- [x] Models grouped into 12 domains → §4
- [x] Scope boundary defined (SJMS, not ERP) → §3
- [x] Topological order computed → §5
- [x] Phase 0 follow-on plan recorded → §6
- [x] Seed scripts to port identified → §7
- [ ] PR closeout: take out of draft, squash-merge — unblocks D1.
- [ ] D1 (generator skeleton) opens against
      `phase-D1/generator-skeleton` from `main`.

## 9. Environment notes for D1+

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
