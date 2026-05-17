/**
 * Model → domain assignment, mirroring docs/dataset/MODEL-DOMAIN-MAP.md.
 *
 * This is the single source of truth the driver uses to:
 *   1. Verify every model in the Prisma schema has a domain owner.
 *   2. Sequence generators in topological order.
 *   3. Route the per-model column header lookup to the right stub.
 *
 * If the Prisma schema gains a new model, add it here AND in
 * docs/dataset/MODEL-DOMAIN-MAP.md — the driver fails loudly otherwise.
 */

export const DOMAINS = [
  'identity', 'reference', 'estates', 'governance', 'staff', 'curriculum',
  'applicants', 'students', 'assessment', 'awards', 'finance-student',
  'longtail',
];

/** Topological generation order — driver runs generators in this order. */
export const TOPOLOGICAL_ORDER = [
  'identity', 'reference', 'estates', 'governance', 'staff', 'curriculum',
  'applicants', 'students', 'assessment', 'awards', 'finance-student',
  'longtail',
];

/**
 * Model → domain. Every Prisma model in the v4-integrated schema (298 as of
 * 2026-05-17) MUST appear here. The driver throws if any model is missing.
 *
 * Counts per domain (must total 298):
 *   identity        27   reference        14
 *   estates          5   governance       10
 *   staff            6   curriculum       32
 *   applicants      16   students         25
 *   assessment      39   awards           15
 *   finance-student 16   longtail         93
 *   Total                              298
 */
export const MODEL_DOMAIN = {
  // identity (27)
  User: 'identity', Role: 'identity', Permission: 'identity', RolePermission: 'identity',
  UserRole: 'identity', Session: 'identity', ApiKey: 'identity', Person: 'identity',
  PersonName: 'identity', ContactMethod: 'identity', PersonAddress: 'identity',
  AddressUsage: 'identity', PersonNationality: 'identity', Citizenship: 'identity',
  ResidencyStatus: 'identity', EmergencyContact: 'identity', IdentityDocument: 'identity',
  SensitiveAttribute: 'identity', ConsentRecord: 'identity', LawfulBasisRecord: 'identity',
  TenantConfiguration: 'identity', SystemConfiguration: 'identity', AuditLog: 'identity',
  EncryptionKeyMetadata: 'identity', PolicyAssignment: 'identity',
  ProcessingPurpose: 'identity', QueryOptimizationHint: 'identity',

  // reference (14)
  AcademicYear: 'reference', HesaCostCentre: 'reference', HesaHecosCode: 'reference',
  HesaSocCode: 'reference', HesaCodingFrame: 'reference', HesaCodingFrameVersion: 'reference',
  HesaQualificationAim: 'reference', HesaReasonForEndingLookup: 'reference',
  HesaQualityRule: 'reference', HesaStaffContractLevel: 'reference',
  HesaSessionYear: 'reference', ProgressionRule: 'reference',
  DocumentTemplate: 'reference', CommunicationTemplate: 'reference',

  // estates (5)
  Campus: 'estates', Building: 'estates', Room: 'estates',
  AccommodationHall: 'estates', AccommodationRoom: 'estates',

  // governance (10)
  Faculty: 'governance', Department: 'governance', DepartmentCostCentre: 'governance',
  Committee: 'governance', CommitteeMember: 'governance', CommitteeMeeting: 'governance',
  CommitteeActionItem: 'governance', StudentOrganisation: 'governance',
  StudentOrgMembership: 'governance', StudentOrgEvent: 'governance',
  CoCurricularRecord: 'governance',

  // staff (6)
  Staff: 'staff', StaffRecord: 'staff', StaffContract: 'staff',
  StaffQualification: 'staff', ExternalExaminer: 'staff', ExternalExaminerAppointment: 'staff',

  // curriculum (32)
  Programme: 'curriculum', ProgrammeSpecification: 'curriculum', ProgrammeVersion: 'curriculum',
  ProgrammeStageModule: 'curriculum', ProgrammeExitAward: 'curriculum',
  ProgrammeContactHours: 'curriculum', ProgrammeLearningOutcome: 'curriculum',
  ProgrammeDeclaration: 'curriculum', PSRBAccreditation: 'curriculum',
  Module: 'curriculum', ModuleSpecification: 'curriculum', ModuleVersion: 'curriculum',
  ModuleLearningOutcome: 'curriculum', ModuleAssessmentComponent: 'curriculum',
  ProposedModule: 'curriculum', ProposedLearningOutcome: 'curriculum',
  CurriculumProposal: 'curriculum', CurriculumStageHistory: 'curriculum',
  CurriculumApprovalGate: 'curriculum', CurriculumComment: 'curriculum',
  CurriculumDocument: 'curriculum', CurriculumMap: 'curriculum',
  CurriculumWorkflow: 'curriculum', WorkflowStage: 'curriculum',
  ValidationPanelMember: 'curriculum', ApprovalCondition: 'curriculum',
  ILOModuleMapping: 'curriculum', AssessmentOutcomeMapping: 'curriculum',
  ProgrammeReview: 'curriculum', AnnualProgrammeReport: 'curriculum',
  PeriodicReview: 'curriculum', QualityAction: 'curriculum',

  // applicants (16)
  Applicant: 'applicants', Application: 'applicants', ApplicantQualification: 'applicants',
  EntryRequirement: 'applicants', TariffCalculation: 'applicants', Offer: 'applicants',
  PersonalStatement: 'applicants', Reference: 'applicants', InterviewSchedule: 'applicants',
  UcasApplication: 'applicants', UcasImportLog: 'applicants', ClearingApplication: 'applicants',
  Prospect: 'applicants', ProspectInteraction: 'applicants', RecruitmentCampaign: 'applicants',
  RecruitmentEvent: 'applicants',

  // students (25)
  Student: 'students', StudentStatusHistory: 'students', Enrolment: 'students',
  ModuleRegistration: 'students', EnrolmentWorkflow: 'students',
  EnrolmentWorkflowStage: 'students', ApprenticeshipRegistration: 'students',
  ApprenticeshipEmployer: 'students', ApprenticeshipOtjRecord: 'students',
  ApprenticeshipGateway: 'students', ApprenticeshipEpa: 'students',
  StudyAim: 'students', StudentInstance: 'students', ProgrammeOccurrence: 'students',
  InstancePeriod: 'students', EnrolmentOccurrence: 'students',
  ModeOfStudyHistory: 'students', InterruptionEvent: 'students',
  TransferEvent: 'students', CompletionEvent: 'students', WithdrawalEvent: 'students',
  PersonalTutorAllocation: 'students', TutorAssignment: 'students',
  TutoringMeeting: 'students', StaffModuleAssignment: 'students',

  // assessment (39)
  Assessment: 'assessment', AssessmentComponent: 'assessment', AssessmentCriteria: 'assessment',
  AssessmentSubmission: 'assessment', Mark: 'assessment', ModerationRecord: 'assessment',
  ExternalExaminerReport: 'assessment', AnonymousMarking: 'assessment',
  TurnitinSubmission: 'assessment', PlagiarismCase: 'assessment', AppealRecord: 'assessment',
  MitigatingCircumstance: 'assessment', ExamBoard: 'assessment',
  ExamBoardDecision: 'assessment', ProgressionRecord: 'assessment',
  AssessmentAttempt: 'assessment', MarkerDecision: 'assessment',
  ModerationDecisionV2: 'assessment', ExternalReviewDecision: 'assessment',
  BoardOutcome: 'assessment', ResultRelease: 'assessment', CalculationAudit: 'assessment',
  ReassessmentRecord: 'assessment', DeferralRecord: 'assessment', ECOutcome: 'assessment',
  ModerationSampleRecord: 'assessment', SecondMarkingRecord: 'assessment',
  CondonementRecord: 'assessment', AttendanceSession: 'assessment',
  AttendanceRecord: 'assessment', AbsenceRecord: 'assessment',
  EngagementScore: 'assessment', EngagementAlert: 'assessment',
  EngagementIntervention: 'assessment', RetentionRiskScore: 'assessment',
  RetentionIntervention: 'assessment', RetentionHistoricalScore: 'assessment',
  NeedsAssessment: 'assessment', ExamAdjustment: 'assessment',

  // awards (15)
  GraduationCohort: 'awards', GraduationRegistration: 'awards', GraduandRecord: 'awards',
  DegreeAward: 'awards', Transcript: 'awards', Certificate: 'awards',
  GraduationCeremony: 'awards', DocumentGeneration: 'awards', GeneratedDocument: 'awards',
  BatchDocumentGeneration: 'awards', Document: 'awards', DocumentPermission: 'awards',
  DocumentSharePointMapping: 'awards', SharePointGroupMapping: 'awards',
  PermissionSyncLog: 'awards',

  // finance-student (16)
  Fee: 'finance-student', Invoice: 'finance-student', Payment: 'finance-student',
  PaymentTransaction: 'finance-student', PaymentPlan: 'finance-student',
  SponsorRecord: 'finance-student', SponsorPayment: 'finance-student',
  BursaryFund: 'finance-student', BursaryApplication: 'finance-student',
  FundingApplication: 'finance-student', Debt: 'finance-student',
  Refund: 'finance-student', SlcLoan: 'finance-student',
  SlcPaymentNotification: 'finance-student', SlcFeeAssessment: 'finance-student',
  ApprenticeshipFundingClaim: 'finance-student',

  // longtail (93) — welfare, placements, pgr, comms, research, regulatory, gdpr-audit, misc,
  // timetabling, accommodation-booking, ai, vle
  // welfare (8)
  SupportTicket: 'longtail', SupportTicketComment: 'longtail', MisconductCase: 'longtail',
  MisconductSanction: 'longtail', DisabilityAdjustment: 'longtail',
  WellbeingRecord: 'longtail', WelfareReferral: 'longtail', CounsellingRecord: 'longtail',
  // placements (9)
  PlacementProvider: 'longtail', StudentPlacement: 'longtail', PlacementVisit: 'longtail',
  CareerEvent: 'longtail', GraduateOutcome: 'longtail',
  GraduateOutcomesResponse: 'longtail', GraduateOutcomesMetrics: 'longtail',
  AlumniRecord: 'longtail', AlumniEvent: 'longtail', AlumniDonation: 'longtail',
  // pgr (6)
  PgrRegistration: 'longtail', PgrSupervisor: 'longtail', PgrMilestone: 'longtail',
  PgrAnnualReview: 'longtail', PgrVivaRecord: 'longtail', PgrThesis: 'longtail',
  // comms (3) — minus CommunicationTemplate already in reference
  StudentCommunication: 'longtail', Notification: 'longtail', NotificationPreference: 'longtail',
  // research (10)
  RefSubmission: 'longtail', RefOutput: 'longtail', RefImpactCase: 'longtail',
  RefEnvironmentStatement: 'longtail', RefStaffReturn: 'longtail',
  RefSubmissionSummary: 'longtail', KefPerspective: 'longtail', KefMetric: 'longtail',
  KefNarrative: 'longtail', KefDashboardSummary: 'longtail',
  // regulatory (24)
  HesaReturn: 'longtail', HesaReturnError: 'longtail', HesaReturnSnapshot: 'longtail',
  HesaLearner: 'longtail', HesaEngagement: 'longtail', HesaStudentCourseSession: 'longtail',
  HesaModuleSnapshot: 'longtail', HesaModuleSubject: 'longtail',
  HesaQualificationSnapshot: 'longtail', HesaQualificationSubject: 'longtail',
  HesaSubmissionRun: 'longtail', HesaValidationResult: 'longtail',
  OfsCondition: 'longtail', OfsReportableEvent: 'longtail', TefMetric: 'longtail',
  StatutoryReturn: 'longtail', VisaRecord: 'longtail', UkviReport: 'longtail',
  UkviContactPoint: 'longtail', CasRecord: 'longtail',
  InternationalPartnership: 'longtail', StudentExchange: 'longtail',
  DataChangeLog: 'longtail', DataQualityLog: 'longtail', DataQualityRule: 'longtail',
  DataQualityAlert: 'longtail', DataQualityBatchRun: 'longtail', ValidationEvent: 'longtail',
  // gdpr-audit (8)
  RetentionPolicy: 'longtail', RetentionScheduleEvent: 'longtail',
  SensitiveFieldAccessLog: 'longtail', BreakGlassApproval: 'longtail',
  DataSubjectRequest: 'longtail', DisclosureRecord: 'longtail',
  BreachIncident: 'longtail', ReportDefinition: 'longtail', ReportInstance: 'longtail',
  // misc (8)
  SurveyTemplate: 'longtail', SurveyInstance: 'longtail', SurveyResponse: 'longtail',
  SelfServiceRequest: 'longtail', WebhookSubscription: 'longtail',
  SystemWorkflowError: 'longtail', InterfaceLog: 'longtail', WorkflowError: 'longtail',
  // timetabling (3)
  RoomBooking: 'longtail', TimetableSlot: 'longtail', TimetableEvent: 'longtail',
  // accommodation-booking (2)
  AccommodationBooking: 'longtail', AccommodationPreference: 'longtail',
  // ai (3)
  AiConversation: 'longtail', AiIndexedDocument: 'longtail', AiDocumentChunk: 'longtail',
  // vle (2)
  MoodleIntegrationMap: 'longtail', MoodleSyncLog: 'longtail',
};

/** Models by domain (built from MODEL_DOMAIN) */
export function modelsByDomain() {
  const grouped = new Map(DOMAINS.map((d) => [d, []]));
  for (const [model, domain] of Object.entries(MODEL_DOMAIN)) {
    grouped.get(domain).push(model);
  }
  return grouped;
}

/**
 * Verify every model in the schema has a domain assignment, and vice versa.
 * Returns { missing: string[], extra: string[] }.
 */
export function verifyCoverage(schemaModelNames) {
  const assigned = new Set(Object.keys(MODEL_DOMAIN));
  const inSchema = new Set(schemaModelNames);
  return {
    missing: [...inSchema].filter((m) => !assigned.has(m)),
    extra: [...assigned].filter((m) => !inSchema.has(m)),
  };
}
