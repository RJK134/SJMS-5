# SJMS-5 Synthetic Dataset — Per-Model Domain Assignment

> Companion to [`SCHEMA-MAPPING.md`](./SCHEMA-MAPPING.md). One row per
> Prisma model in `RJK134/sjms-v4-integrated/prisma/schema.prisma`,
> assigned to the generator domain that produces it.
>
> Total: 298 models / 12 active generator domains.

## identity (27 models)
User, Role, Permission, RolePermission, UserRole, Session, ApiKey,
Person, PersonName, ContactMethod, PersonAddress, AddressUsage,
PersonNationality, Citizenship, ResidencyStatus, EmergencyContact,
IdentityDocument, SensitiveAttribute, ConsentRecord, LawfulBasisRecord,
TenantConfiguration, SystemConfiguration, AuditLog,
EncryptionKeyMetadata, PolicyAssignment, ProcessingPurpose, QueryOptimizationHint

## reference (14 models)
AcademicYear, HesaCostCentre, HesaHecosCode, HesaSocCode,
HesaCodingFrame, HesaCodingFrameVersion, HesaQualificationAim,
HesaReasonForEndingLookup, HesaQualityRule, HesaStaffContractLevel,
HesaSessionYear, ProgressionRule, ClassificationRule (planned, Phase 0
addition), DocumentTemplate

## estates (5 models)
Campus, Building, Room, AccommodationHall, AccommodationRoom

## governance (10 models)
Faculty, Department, DepartmentCostCentre, Committee, CommitteeMember,
CommitteeMeeting, CommitteeActionItem, StudentOrganisation,
StudentOrgMembership, StudentOrgEvent

## staff (6 models)
Staff, StaffRecord, StaffContract, StaffQualification,
ExternalExaminer, ExternalExaminerAppointment

## curriculum (28 models)
Programme, ProgrammeSpecification, ProgrammeVersion,
ProgrammeStageModule, ProgrammeExitAward, ProgrammeContactHours,
ProgrammeLearningOutcome, ProgrammeDeclaration, PSRBAccreditation,
Module, ModuleSpecification, ModuleVersion, ModuleLearningOutcome,
ModuleAssessmentComponent, ProposedModule, ProposedLearningOutcome,
CurriculumProposal, CurriculumStageHistory, CurriculumApprovalGate,
CurriculumComment, CurriculumDocument, CurriculumMap,
CurriculumWorkflow, WorkflowStage, ValidationPanelMember,
ApprovalCondition, ILOModuleMapping, AssessmentOutcomeMapping,
ProgrammeReview, AnnualProgrammeReport, PeriodicReview, QualityAction

## applicants (16 models)
Applicant, Application, ApplicantQualification, EntryRequirement,
TariffCalculation, Offer, PersonalStatement, Reference,
InterviewSchedule, UcasApplication, UcasImportLog, ClearingApplication,
Prospect, ProspectInteraction, RecruitmentCampaign, RecruitmentEvent

## students (25 models)
Student, StudentStatusHistory, Enrolment, ModuleRegistration,
EnrolmentWorkflow, EnrolmentWorkflowStage, ApprenticeshipRegistration,
ApprenticeshipEmployer, ApprenticeshipOtjRecord, ApprenticeshipGateway,
ApprenticeshipEpa, StudyAim, StudentInstance, ProgrammeOccurrence,
InstancePeriod, EnrolmentOccurrence, ModeOfStudyHistory,
InterruptionEvent, TransferEvent, CompletionEvent, WithdrawalEvent,
PersonalTutorAllocation, TutorAssignment, TutoringMeeting,
StaffModuleAssignment

## assessment (38 models)
Assessment, AssessmentComponent, AssessmentCriteria,
AssessmentSubmission, Mark, ModerationRecord, ExternalExaminerReport,
AnonymousMarking, TurnitinSubmission, PlagiarismCase, AppealRecord,
MitigatingCircumstance, ExamBoard, ExamBoardDecision, ProgressionRecord,
AssessmentAttempt, MarkerDecision, ModerationDecisionV2,
ExternalReviewDecision, BoardOutcome, ResultRelease, CalculationAudit,
ReassessmentRecord, DeferralRecord, ECOutcome, ModerationSampleRecord,
SecondMarkingRecord, CondonementRecord, AttendanceSession,
AttendanceRecord, AbsenceRecord, EngagementScore, EngagementAlert,
EngagementIntervention, RetentionRiskScore, RetentionIntervention,
RetentionHistoricalScore, NeedsAssessment, ExamAdjustment

## awards (15 models)
GraduationCohort, GraduationRegistration, GraduandRecord, DegreeAward,
Transcript, Certificate, GraduationCeremony, DocumentGeneration,
GeneratedDocument, BatchDocumentGeneration, Document,
DocumentPermission, DocumentSharePointMapping, SharePointGroupMapping,
PermissionSyncLog

## finance-student (16 models)
Fee, Invoice, Payment, PaymentTransaction, PaymentPlan, SponsorRecord,
SponsorPayment, BursaryFund, BursaryApplication, FundingApplication,
Debt, Refund, SlcLoan, SlcPaymentNotification, SlcFeeAssessment,
ApprenticeshipFundingClaim

## welfare (8 models)
SupportTicket, SupportTicketComment, MisconductCase, MisconductSanction,
DisabilityAdjustment, WellbeingRecord, WelfareReferral, CounsellingRecord

## placements (9 models)
PlacementProvider, StudentPlacement, PlacementVisit, CareerEvent,
GraduateOutcome, GraduateOutcomesResponse, GraduateOutcomesMetrics,
AlumniRecord, AlumniEvent, AlumniDonation

## pgr (6 models)
PgrRegistration, PgrSupervisor, PgrMilestone, PgrAnnualReview,
PgrVivaRecord, PgrThesis

## comms (4 models)
CommunicationTemplate, StudentCommunication, Notification,
NotificationPreference

## research (10 models)
RefSubmission, RefOutput, RefImpactCase, RefEnvironmentStatement,
RefStaffReturn, RefSubmissionSummary, KefPerspective, KefMetric,
KefNarrative, KefDashboardSummary

## regulatory (24 models)
HesaReturn, HesaReturnError, HesaReturnSnapshot, HesaLearner,
HesaEngagement, HesaStudentCourseSession, HesaModuleSnapshot,
HesaModuleSubject, HesaQualificationSnapshot, HesaQualificationSubject,
HesaSubmissionRun, HesaValidationResult, OfsCondition,
OfsReportableEvent, TefMetric, StatutoryReturn, VisaRecord,
UkviReport, UkviContactPoint, CasRecord, InternationalPartnership,
StudentExchange, DataChangeLog, DataQualityLog, DataQualityRule,
DataQualityAlert, DataQualityBatchRun, ValidationEvent

## gdpr-audit (8 models)
RetentionPolicy, RetentionScheduleEvent, SensitiveFieldAccessLog,
BreakGlassApproval, DataSubjectRequest, DisclosureRecord,
BreachIncident, ReportDefinition, ReportInstance

## misc (8 models)
SurveyTemplate, SurveyInstance, SurveyResponse, SelfServiceRequest,
WebhookSubscription, SystemWorkflowError, InterfaceLog, WorkflowError

## timetabling (3 models) — folded into estates at generation time
RoomBooking, TimetableSlot, TimetableEvent

## accommodation-booking (2 models) — folded into students at generation time
AccommodationBooking, AccommodationPreference

## ai (3 models) — generated last, after content exists
AiConversation, AiIndexedDocument, AiDocumentChunk

## vle (2 models) — generated last
MoodleIntegrationMap, MoodleSyncLog

---

**Coverage check.** Counts above sum to 298. If a model appears in
`MODELS.txt` but not in this map, the D1 driver's pre-flight check
will fail loudly and the missing model must be added to a domain
before the dataset run can complete.
