# D0 — SJMS-5 Schema Audit

> Status: **D0 verification** for HANDOVER 2026-05-17, Strand 2.
> Source schema: `prisma/schema.prisma` (197 models).
> Dataset reference: `output/2026-05-17/manifest.json` (298 tables, generated against the upstream `sjms-v4-integrated` schema).
> Importer: `scripts/import-sjms-dataset.mjs` (dry-run output captured 2026-05-19).

---

## 1. Headline numbers

| Metric                                                | Value |
| ----------------------------------------------------- | ----: |
| SJMS-5 Prisma models                                  |   197 |
| Dataset CSV tables (manifest `totalTables`)           |   298 |
| Dataset rows in the 2026-05-17 snapshot               | 5,292,376 |
| Cleanly importable today (`covered`)                  |    11 |
| Shape-incompatible (`skippedShape`)                   |    55 |
| Dataset has CSV, SJMS-5 has no model (`skippedNoModel`) |  227 |
| Dataset model in `MODEL_DOMAIN` but no rows in CSV (`skippedNoCsv`) |  5 |
| SJMS-5 models entirely absent from the dataset        |   126 |

> The HANDOVER said "199 models" — the schema in `main` carries **197**.
> The dataset README references 196 — both are out by 1–3 because the
> schema has drifted under Phase 1 work without the dataset being
> regenerated. Convergence is a Phase 12 / KI-S5-202 deliverable.

> The HANDOVER said "5 no csv (SJMS-5 has, dataset doesn't)". That is
> the **classifier** number: 5 dataset models that are listed in
> `MODEL_DOMAIN` but produced 0 rows. The honest "SJMS-5 has, dataset
> doesn't" count is **126** (Section 6).

---

## 2. SJMS-5 models grouped by domain (197 total)

Grouping is heuristic — name patterns + the dataset's `MODEL_DOMAIN`.
Counts in parentheses.

### Identity (13)
ConsentRecord, EmergencyContact, Person, PersonAddress, PersonContact, PersonDemographic, PersonIdentifier, PersonName, PersonNationality, PersonPhoto, PolicyDocument, SystemSetting, User

### Curriculum (23)
AcademicYear, AwardRecord, Committee, CommitteeAgendaItem, CommitteeMeeting, CommitteeMember, Department, Faculty, LearningOutcome, Module, ModuleDelivery, ModulePrerequisite, ModuleResult, ModuleSpecification, Programme, ProgrammeAccreditation, ProgrammeApproval, ProgrammeModule, ProgrammePathway, ProgrammeSpecification, ProgrammeVersion, StudentProgrammeRoute, WorkflowError

### Admissions (10)
AdmissionsEvent, AdmissionsEventAttendee, AgentApplication, Applicant, Application, ApplicationQualification, ApplicationReference, Interview, OfferCondition, UCASTariff

### Enrolment (17)
Enrolment, EnrolmentDocument, EnrolmentStatusHistory, EnrolmentTask, FinancialPeriod, GraduationRegistration, InterruptionRecord, ModuleRegistration, PersonalTutoring, RegistrationPeriod, Student, StudentCourseSession, StudentGroup, StudentGroupMember, StudentInstance, TutoringAction, WithdrawalRecord

### Assessment (24)
AnonymousMarking, Appeal, Assessment, AssessmentAttempt, AssessmentComponent, AssessmentCriteria, AssessmentExtension, AssessmentPattern, AttendanceAlert, AttendanceExemption, AttendanceRecord, AttendanceTarget, EngagementIntervention, EngagementScore, ExamBoard, ExamBoardDecision, ExamBoardMember, ModerationRecord, PlacementAssessment, PlagiarismCase, ProgressionRecord, SecondMarkingRecord, TeachingGroup, TeachingGroupMember

### Finance (16)
BursaryApplication, BursaryFund, ChargeLine, CreditNote, DebtAction, ECClaim, FeeAssessment, FeeRate, FinancialTransaction, Invoice, Payment, PaymentInstalment, PaymentPlan, RefundApproval, SponsorAgreement, StudentAccount

### Research (1)
ReferralRecord

> Research is genuinely thin in SJMS-5 today. The dataset carries 16
> models in this space (Ref* + Kef* + Pgr*) — all currently in
> Section 5 ("no model"). Closing this gap is a Phase 11 concern.

### HR (6)
Agent, ExternalExaminer, Staff, StaffAvailability, StaffContract, StaffQualification

### Accommodation (12)
AcademicCalendar, AccommodationApplication, AccommodationBlock, AccommodationBooking, AccommodationRoom, Room, RoomBooking, TeachingEvent, TeachingWeek, TermDate, TimetableClash, TimetableSlot

### Reporting (51)
AuditLog, BulkCommunication, Certificate, ClassificationRule, CommunicationLog, Country, CreditFramework, DataClassification, DataFuturesEntity, DataProtectionRequest, DegreeCalculation, DiplomaSupplement, Document, DocumentVerification, GeneratedLetter, GradeBoundary, GradeScale, GradeScaleEntry, GraduationCeremony, HECoSCode, HESACodeTable, HESAEntryQualification, HESAFieldMapping, HESAModule, HESANotification, HESAReturn, HESASnapshot, HESAStudent, HESAStudentModule, HESAValidationRule, Institution, IntegrationLog, JACSCode, LetterTemplate, Notification, NotificationPreference, OutboxEvent, PriorQualification, ProgressionRule, QualificationAim, School, StatutoryReturn, StatutoryReturnRun, TemplateVariable, Transcript, TranscriptLine, UKVIAttendanceMonitoring, UKVIContactPoint, UKVIRecord, UKVIReport, WebhookSubscription

### Other (24)
AccessibilityRequirement, AlumniRecord, ChangeOfCircumstances, ClearanceCheck, CommunicationTemplate, Complaint, DisabilityAdjustment, DisabilityRecord, DisciplinaryCase, FitnessToStudy, MarkEntry, MarkingScheme, MentalHealthRecord, NextOfKin, Placement, PlacementProvider, PlacementVisit, QualificationReference, StudentFlag, Submission, SupportInteraction, SupportTicket, UCASChoice, WellbeingRecord

> "Other" captures welfare, placements, alumni and a handful of legacy
> bridge models. They are real SJMS-5 models, just orthogonal to the
> ten requested buckets.

**Domain totals:** 13 + 23 + 10 + 17 + 24 + 16 + 1 + 6 + 12 + 51 + 24 = **197** ✓

---

## 3. The 11 cleanly importable tables

These are the tables where the SJMS-5 model exists AND every required
column is present in the CSV header. Importer writes them under
`--persist` without further work.

| Generator domain | CSV table                | Rows in snapshot |
| ---------------- | ------------------------ | ---------------: |
| governance       | committee_meetings       |            1,463 |
| staff            | staff                    |              980 |
| curriculum       | programme_specifications |            1,248 |
| curriculum       | module_specifications    |            3,360 |
| assessment       | plagiarism_cases         |              630 |
| assessment       | exam_board_decisions     |           78,786 |
| assessment       | assessment_attempts      |          134,638 |
| assessment       | engagement_interventions |            1,550 |
| awards           | transcripts              |           12,000 |
| longtail         | support_tickets          |            5,000 |
| longtail         | alumni_records           |           12,000 |
| **Total**        |                          |      **251,655** |

That is 4.8 % of the 5.29M rows in the snapshot. The other 95 % is
gated behind the 282 skipped tables in Sections 4–6.

---

## 4. Shape-incompatible (55) — missing required columns

The SJMS-5 model exists, but at least one required field (non-optional,
no `@default`) is not present in the CSV header.

| Table | Missing required columns | Rows | Inbound FK refs |
| --- | --- | ---: | ---: |
| academic_years | yearCode | 7 | 17 |
| accommodation_bookings | startDate, endDate, weeklyRent, totalCost | 6,000 | 0 |
| accommodation_rooms | blockId, weeklyRent, contractLength | 6,029 | 0 |
| applicants | applicantNumber, applicationRoute | 10,000 | 5 |
| applications | academicYear, applicationRoute | 10,000 | 5 |
| assessment_criteria | assessmentId, title, maxMark | 51,930 | 0 |
| assessments | academicYear, weighting, maxMark | 25,965 | 11 |
| attendance_records | date | 78,786 | 0 |
| bursary_applications | bursaryFundId | 5,000 | 0 |
| bursary_funds | fundName, fundType, totalBudget, remaining | 8 | 0 |
| certificates | studentId, certificateNumber, issueDate | 12,000 | 0 |
| committee_members | staffId | 472 | 0 |
| committees | committeeName | 32 | 3 |
| communication_templates | templateCode, title, category, channel, body | 10 | 0 |
| consent_records | studentId, consentType | 231,920 | 0 |
| departments | schoolId, title | 48 | 8 |
| documents | title, filePath | 24,000 | 3 |
| engagement_scores | academicYear, weekNumber | 78,786 | 0 |
| enrolments | academicYear, yearOfStudy, startDate, feeStatus | 78,786 | 10 |
| exam_boards | title, programmeId, boardType | 192 | 2 |
| external_examiners | staffId, appointmentStart, appointmentEnd | 50 | 1 |
| faculties | title | 6 | 4 |
| graduation_ceremonies | ceremonyName | 5 | 0 |
| graduation_registrations | ceremonyId | 12,000 | 0 |
| invoices | studentAccountId, issueDate | 78,786 | 1 |
| moderation_records | outcome | 13,653 | 0 |
| module_registrations | academicYear, registrationType | 426,966 | 5 |
| modules | moduleCode, title, level | 3,360 | 10 |
| notification_preferences | userId, channel, category | 60,000 | 0 |
| notifications | userId, category | 30,000 | 0 |
| payment_plans | studentAccountId, planType, numberOfInstalments, instalmentAmount | 9,378 | 0 |
| payments | studentAccountId, transactionDate | 97,542 | 1 |
| person_addresses | personId, addressType, addressLine1, startDate | 62,980 | 0 |
| person_names | startDate | 62,980 | 0 |
| person_nationalities | countryCode | 62,980 | 0 |
| persons | firstName, lastName | 62,980 | 17 |
| placement_providers | providerName | 200 | 0 |
| placement_visits | visitorName | 1,962 | 0 |
| programme_versions | version, effectiveFrom | 1,248 | 6 |
| programmes | programmeCode, title, level, creditTotal | 624 | 20 |
| progression_records | academicYear, yearOfStudy, totalCreditsAttempted, totalCreditsPassed, progressionDecision | 38,786 | 0 |
| progression_rules | programmeLevel, yearOfStudy, minCreditsToPass, updatedAt | 1,384 | 0 |
| room_bookings | date | 6,000 | 0 |
| rooms | roomCode, building | 711 | 3 |
| second_marking_records | assessmentId, studentId, firstMarkerMark, secondMarkerMark | 3,968 | 0 |
| staff_contracts | staffId | 1,474 | 0 |
| staff_qualifications | staffId, qualTitle, institution | 1,370 | 0 |
| statutory_returns | academicYear | 8 | 0 |
| student_instances | studentId, programmeId, academicYearId, yearOfStudy | 78,786 | 6 |
| students | feeStatus, entryRoute, originalEntryDate | 52,000 | 65 |
| timetable_slots | teachingEventId | 3,000 | 0 |
| users | keycloakId | 11 | 6 |
| webhook_subscriptions | url, eventTypes, secretKey | 20 | 0 |
| wellbeing_records | referralSource, concern | 8,000 | 0 |
| workflow_errors | updatedAt | 100 | 0 |

> Two reasons a column ends up "missing":
> 1. The dataset generator never emits that column (most common — the
>    SJMS-5 model gained the field after the dataset was last shaped).
> 2. The dataset emits a differently-named column (e.g. `name` instead
>    of `title`). Rename in the generator is the quick fix; deleting
>    the SJMS-5 `@unique`/`required` constraint is the lazy one.

---

## 5. No-model (227) — dataset CSV exists, SJMS-5 has no Prisma model

Grouped by the dataset's generator domain. Adding any of these to
`schema.prisma` would unlock the corresponding CSV (subject to shape
checks). Names are dataset model names (PascalCase); the importer
guesses the CSV filename via snake_case + plural.

### identity (19)
AddressUsage, ApiKey, Citizenship, ContactMethod, EncryptionKeyMetadata, IdentityDocument, LawfulBasisRecord, Permission, PolicyAssignment, ProcessingPurpose, QueryOptimizationHint, ResidencyStatus, Role, RolePermission, SensitiveAttribute, Session, SystemConfiguration, TenantConfiguration, UserRole

### reference (11)
DocumentTemplate, HesaCodingFrame, HesaCodingFrameVersion, HesaCostCentre, HesaHecosCode, HesaQualificationAim, HesaQualityRule, HesaReasonForEndingLookup, HesaSessionYear, HesaSocCode, HesaStaffContractLevel

### estates (3)
AccommodationHall, Building, Campus

### governance (6)
CoCurricularRecord, CommitteeActionItem, DepartmentCostCentre, StudentOrgEvent, StudentOrgMembership, StudentOrganisation

### staff (2)
ExternalExaminerAppointment, StaffRecord

### curriculum (27)
AnnualProgrammeReport, ApprovalCondition, AssessmentOutcomeMapping, CurriculumApprovalGate, CurriculumComment, CurriculumDocument, CurriculumMap, CurriculumProposal, CurriculumStageHistory, CurriculumWorkflow, ILOModuleMapping, ModuleAssessmentComponent, ModuleLearningOutcome, ModuleVersion, PSRBAccreditation, PeriodicReview, ProgrammeContactHours, ProgrammeDeclaration, ProgrammeExitAward, ProgrammeLearningOutcome, ProgrammeReview, ProgrammeStageModule, ProposedLearningOutcome, ProposedModule, QualityAction, ValidationPanelMember, WorkflowStage

### applicants (14)
ApplicantQualification, ClearingApplication, EntryRequirement, InterviewSchedule, Offer, PersonalStatement, Prospect, ProspectInteraction, RecruitmentCampaign, RecruitmentEvent, Reference, TariffCalculation, UcasApplication, UcasImportLog

### students (21)
ApprenticeshipEmployer, ApprenticeshipEpa, ApprenticeshipGateway, ApprenticeshipOtjRecord, ApprenticeshipRegistration, CompletionEvent, EnrolmentOccurrence, EnrolmentWorkflow, EnrolmentWorkflowStage, InstancePeriod, InterruptionEvent, ModeOfStudyHistory, PersonalTutorAllocation, ProgrammeOccurrence, StaffModuleAssignment, StudentStatusHistory, StudyAim, TransferEvent, TutorAssignment, TutoringMeeting, WithdrawalEvent

### assessment (25)
AbsenceRecord, AppealRecord, AssessmentSubmission, AttendanceSession, BoardOutcome, CalculationAudit, CondonementRecord, DeferralRecord, ECOutcome, EngagementAlert, ExamAdjustment, ExternalExaminerReport, ExternalReviewDecision, Mark, MarkerDecision, MitigatingCircumstance, ModerationDecisionV2, ModerationSampleRecord, NeedsAssessment, ReassessmentRecord, ResultRelease, RetentionHistoricalScore, RetentionIntervention, RetentionRiskScore, TurnitinSubmission

### awards (10)
BatchDocumentGeneration, DegreeAward, DocumentGeneration, DocumentPermission, DocumentSharePointMapping, GeneratedDocument, GraduandRecord, GraduationCohort, PermissionSyncLog, SharePointGroupMapping

### finance-student (11)
ApprenticeshipFundingClaim, Debt, Fee, FundingApplication, PaymentTransaction, Refund, SlcFeeAssessment, SlcLoan, SlcPaymentNotification, SponsorPayment, SponsorRecord

### longtail (78)
AccommodationPreference, AiConversation, AiDocumentChunk, AiIndexedDocument, AlumniDonation, AlumniEvent, BreachIncident, BreakGlassApproval, CareerEvent, CasRecord, CounsellingRecord, DataChangeLog, DataQualityAlert, DataQualityBatchRun, DataQualityLog, DataQualityRule, DataSubjectRequest, DisclosureRecord, GraduateOutcome, GraduateOutcomesMetrics, GraduateOutcomesResponse, HesaEngagement, HesaLearner, HesaModuleSnapshot, HesaModuleSubject, HesaQualificationSnapshot, HesaQualificationSubject, HesaReturn, HesaReturnError, HesaReturnSnapshot, HesaStudentCourseSession, HesaSubmissionRun, HesaValidationResult, InterfaceLog, InternationalPartnership, KefDashboardSummary, KefMetric, KefNarrative, KefPerspective, MisconductCase, MisconductSanction, MoodleIntegrationMap, MoodleSyncLog, OfsCondition, OfsReportableEvent, PgrAnnualReview, PgrMilestone, PgrRegistration, PgrSupervisor, PgrThesis, PgrVivaRecord, RefEnvironmentStatement, RefImpactCase, RefOutput, RefStaffReturn, RefSubmission, RefSubmissionSummary, ReportDefinition, ReportInstance, RetentionPolicy, RetentionScheduleEvent, SelfServiceRequest, SensitiveFieldAccessLog, StudentCommunication, StudentExchange, StudentPlacement, SupportTicketComment, SurveyInstance, SurveyResponse, SurveyTemplate, SystemWorkflowError, TefMetric, TimetableEvent, UkviContactPoint, UkviReport, ValidationEvent, VisaRecord, WelfareReferral

> The 78-strong longtail covers research (REF/KEF/PGR), the full HESA
> regulatory return surface, GDPR audit, surveys, AI scaffolding and
> Moodle integration. These are deferred until the relevant phase
> picks them up.

---

## 6. No-csv — SJMS-5 has the model, dataset has no rows

### 6a. Classifier view (5)

Dataset models declared in `MODEL_DOMAIN` but the snapshot wrote 0 rows.

| Dataset model         | CSV file                  |
| --------------------- | ------------------------- |
| EmergencyContact      | emergency_contacts.csv    |
| AuditLog              | audit_logs.csv            |
| AssessmentComponent   | assessment_components.csv |
| AnonymousMarking      | anonymous_markings.csv    |
| DisabilityAdjustment  | disability_adjustments.csv |

> All five have a corresponding SJMS-5 model. They are listed for
> generation but the relevant factory produced an empty CSV — likely a
> Phase 0 / Phase 1 generator gap. Fixing the factory is the only work.

### 6b. Honest view (126)

SJMS-5 models that the dataset does not generate at all
(name not present in `MODEL_DOMAIN` and no matching CSV).

AcademicCalendar, AccessibilityRequirement, AccommodationApplication,
AccommodationBlock, AdmissionsEvent, AdmissionsEventAttendee, Agent,
AgentApplication, Appeal, ApplicationQualification,
ApplicationReference, AssessmentExtension, AssessmentPattern,
AttendanceAlert, AttendanceExemption, AttendanceTarget, AwardRecord,
BulkCommunication, ChangeOfCircumstances, ChargeLine,
ClassificationRule, ClearanceCheck, CommitteeAgendaItem,
CommunicationLog, Complaint, Country, CreditFramework, CreditNote,
DataClassification, DataFuturesEntity, DataProtectionRequest,
DebtAction, DegreeCalculation, DiplomaSupplement, DisabilityRecord,
DisciplinaryCase, DocumentVerification, ECClaim, EnrolmentDocument,
EnrolmentStatusHistory, EnrolmentTask, ExamBoardMember, FeeAssessment,
FeeRate, FinancialPeriod, FinancialTransaction, FitnessToStudy,
GeneratedLetter, GradeBoundary, GradeScale, GradeScaleEntry,
HECoSCode, HESACodeTable, HESAEntryQualification, HESAFieldMapping,
HESAModule, HESANotification, HESAReturn, HESASnapshot, HESAStudent,
HESAStudentModule, HESAValidationRule, Institution, IntegrationLog,
InterruptionRecord, Interview, JACSCode, LearningOutcome,
LetterTemplate, MarkEntry, MarkingScheme, MentalHealthRecord,
ModuleDelivery, ModulePrerequisite, ModuleResult, NextOfKin,
OfferCondition, OutboxEvent, PaymentInstalment, PersonContact,
PersonDemographic, PersonIdentifier, PersonPhoto, PersonalTutoring,
Placement, PlacementAssessment, PolicyDocument, PriorQualification,
ProgrammeAccreditation, ProgrammeApproval, ProgrammeModule,
ProgrammePathway, QualificationAim, QualificationReference,
ReferralRecord, RefundApproval, RegistrationPeriod, School,
SponsorAgreement, StaffAvailability, StatutoryReturnRun,
StudentAccount, StudentCourseSession, StudentFlag, StudentGroup,
StudentGroupMember, StudentProgrammeRoute, Submission, SupportInteraction,
SystemSetting, TeachingEvent, TeachingGroup, TeachingGroupMember,
TeachingWeek, TemplateVariable, TermDate, TimetableClash,
TranscriptLine, TutoringAction, UCASChoice, UCASTariff,
UKVIAttendanceMonitoring, UKVIContactPoint, UKVIRecord, UKVIReport,
WithdrawalRecord

> These are mostly SJMS-2.5 lineage models — admissions extensions,
> finance detail, HESA reporting scaffolding, timetabling and the
> School/Country/Institution reference triad. The dataset will need
> generator additions in `scripts/generate-synthetic-dataset.mjs`
> before any of these can be populated from a snapshot.

---

## 7. Top-10 leverage gaps

Scoring favours **low effort** (few missing columns) and **high
fan-out** (many other dataset tables FK into this one). Closing these
in order should expand the importable set fastest.

| # | Table | Missing required columns | Inbound FK refs | Rows | Why it matters |
| - | --- | --- | ---: | ---: | --- |
| 1 | **students** | feeStatus, entryRoute, originalEntryDate | 65 | 52,000 | Single highest fan-out in the schema; every enrolment / fee / mark / consent row depends on it. |
| 2 | **programmes** | programmeCode, title, level, creditTotal | 20 | 624 | Backbone of the curriculum graph; unlocks programme_versions, module joins, exam boards. |
| 3 | **persons** | firstName, lastName | 17 | 62,980 | Two trivial column renames in the generator. Persons underpin staff, applicants, students and emergency contacts. |
| 4 | **academic_years** | yearCode | 7 | 17 | Single missing column; reference table referenced by 17 others. Lowest-effort win. |
| 5 | **assessments** | academicYear, weighting, maxMark | 11 | 25,965 | Required by criteria, attempts, second-marking, moderation records. |
| 6 | **enrolments** | academicYear, yearOfStudy, startDate, feeStatus | 10 | 78,786 | Required for module_registrations, attendance, engagement, progression. |
| 7 | **modules** | moduleCode, title, level | 10 | 3,360 | Required by module_registrations (426 k rows), assessments, delivery, prerequisites. |
| 8 | **departments** | schoolId, title | 8 | 48 | Tiny table, but staff / programmes / committees all FK to it. Requires the SJMS-5 School model to be populated first. |
| 9 | **programme_versions** | version, effectiveFrom | 6 | 1,248 | Versioning spine for the curriculum — required for ProgrammeApproval / ProgrammeModule wiring. |
| 10 | **users** | keycloakId | 6 | 11 | One column. The CSV is trivially small (11 users); a fixed-value generator patch closes this in minutes and unblocks every user-FK chain. |

### Effort vs. payoff at a glance

- **Quick wins (≤ 1 missing column):** `academic_years`, `users`,
  `faculties`, `attendance_records`, `statutory_returns`,
  `workflow_errors`, `moderation_records`. All trivially fixable by
  the dataset generator with no schema change.
- **Schema-side fixes worth considering:** any column the generator
  legitimately can't synthesise (e.g. `keycloakId`) should become
  optional or `@default` in `schema.prisma` — provided that does not
  break a Phase-1 invariant.

---

## 8. Upstream `sjms-v4-integrated` — convergence gap

The dataset targets the upstream `sjms-v4-integrated` schema, declared
as **298 models** in `output/2026-05-17/manifest.json` (field
`schemaModels`). The upstream schema file
(`RJK134/sjms-v4-integrated/server/prisma/schema.prisma`) is **not
present on this machine** — only its derived dataset is.

**Convergence gap:**

| Direction                              | Count |
| -------------------------------------- | ----: |
| Dataset models missing from SJMS-5     |   227 |
| SJMS-5 models missing from dataset     |   126 |
| Shared model name, shape mismatch      |    55 |
| Shared model name, shape compatible    |    11 |
| Shared model name with empty CSV       |     5 |
| **Total dataset models**               |   298 |
| **Total SJMS-5 models**                |   197 |

Overlap by name: 71 of 197 SJMS-5 models (36 %) have a matching dataset
model. Of those, only **11 (5.6 %)** import cleanly today.

> Convergence is tracked as KI-S5-202 (Phase 12). The pragmatic D0
> stance is: keep the 197-model schema stable, accept the dataset gap
> as known, and focus Phase 1–4 work on the 11 importable tables plus
> the top-10 leverage fixes.

---

## 9. Reproducing this audit

```bash
node scripts/import-sjms-dataset.mjs \
  --source ./output/2026-05-17 \
  --dry-run
```

Counts in this document are pinned to the **2026-05-17** snapshot
(`schemaHash de47e71164350a337c06a14dde3ff13e983b114c307e79445907fa76f3db1a0e`).
Re-run after every schema migration or dataset regeneration; the
importer's own coverage report (top of every dry-run) is the
authoritative source.
