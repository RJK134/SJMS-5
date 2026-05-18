/**
 * curriculum generator (D4)
 *
 * Populates 32 curriculum-domain models with realistic UK HE programme +
 * module + approval-workflow data.
 *
 * Volumes:
 *   Programme                    ~600 across 48 departments
 *   ProgrammeVersion             ~800 (current + 1 historical per programme)
 *   ProgrammeSpecification       ~800
 *   ProgrammeStageModule       ~6,000 (10 modules × stage)
 *   ProgrammeExitAward           ~700 (intermediate exit awards for UG)
 *   ProgrammeContactHours      ~1,200 (per stage per version)
 *   ProgrammeLearningOutcome   ~3,000 (5 per programme)
 *   ProgrammeDeclaration         ~600
 *   PSRBAccreditation             ~80 (mostly STEM + health)
 *   Module                     ~3,000 across 48 departments
 *   ModuleVersion              ~3,600 (current + occasional historical)
 *   ModuleSpecification        ~3,000
 *   ModuleLearningOutcome     ~12,000 (4 per module)
 *   ModuleAssessmentComponent  ~7,500 (2-3 per module)
 *   ILOModuleMapping          ~10,000
 *   AssessmentOutcomeMapping        0 (assessments emerge in D7; we cross-back)
 *   ProgressionRule            ~1,200 (per ProgrammeVersion FHEQ transition)
 *   ProgrammeReview              ~600 (one per programme historical)
 *   AnnualProgrammeReport      ~3,000 (per programme per AY × 5)
 *   PeriodicReview               ~600 (5-yearly cycle)
 *   QualityAction              ~1,000
 *   CurriculumWorkflow              1
 *   WorkflowStage                  14
 *   CurriculumProposal           ~150 (~50 in-flight + 100 historical)
 *   CurriculumStageHistory     ~1,200 (~8 transitions per proposal)
 *   CurriculumApprovalGate     ~1,200
 *   CurriculumComment            ~600
 *   CurriculumDocument           ~750
 *   CurriculumMap                ~600
 *   ValidationPanelMember        ~600
 *   ApprovalCondition            ~300
 *   ProposedModule               ~300
 *   ProposedLearningOutcome    ~1,000
 *
 * Plus cross-domain back-fill:
 *   ExternalExaminerAppointment (staff domain) — one per programme per AY
 *
 * Total D4 contribution: ~50,000-60,000 rows.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ALL_DEPARTMENTS, FACULTIES } from '../lib/uk-uni-skeleton.mjs';
import { PROGRAMME_TYPES_WEIGHTED, ASSESSMENT_TYPES } from '../lib/uk-demographics.mjs';
import { ACADEMIC_YEARS, ayStartDate } from '../lib/academic-calendar.mjs';

export const domain = 'curriculum';

const PROG_TYPE_DETAILS = {
  BSC:   { award: 'BSc (Hons)',     level: 'UG',  fheq: 6, duration: 36, credits: 360, hesaAim: 'F40' },
  BA:    { award: 'BA (Hons)',      level: 'UG',  fheq: 6, duration: 36, credits: 360, hesaAim: 'F40' },
  MENG:  { award: 'MEng',           level: 'UG',  fheq: 7, duration: 48, credits: 480, hesaAim: 'F43' },
  LLB:   { award: 'LLB (Hons)',     level: 'UG',  fheq: 6, duration: 36, credits: 360, hesaAim: 'F44' },
  FDA:   { award: 'FdA',            level: 'UG',  fheq: 5, duration: 24, credits: 240, hesaAim: 'F41' },
  MSC:   { award: 'MSc',            level: 'PGT', fheq: 7, duration: 12, credits: 180, hesaAim: 'M30' },
  MA:    { award: 'MA',             level: 'PGT', fheq: 7, duration: 12, credits: 180, hesaAim: 'M30' },
  MBA:   { award: 'MBA',            level: 'PGT', fheq: 7, duration: 12, credits: 180, hesaAim: 'M30' },
  MRES:  { award: 'MRes',           level: 'PGT', fheq: 7, duration: 12, credits: 180, hesaAim: 'M40' },
  MPHIL: { award: 'MPhil',          level: 'PGR', fheq: 7, duration: 24, credits: 0,   hesaAim: 'M40' },
  PHD:   { award: 'PhD',            level: 'PGR', fheq: 8, duration: 36, credits: 0,   hesaAim: 'M50' },
  EDD:   { award: 'EdD',            level: 'PGR', fheq: 8, duration: 48, credits: 0,   hesaAim: 'M50' },
  LLM:   { award: 'LLM',            level: 'PGT', fheq: 7, duration: 12, credits: 180, hesaAim: 'M30' },
};

const MODULE_NAME_PATTERNS = {
  level3: ['Foundations of {subject}', 'Introduction to {subject}', 'Academic Skills for {subject}', 'Study Skills'],
  level4: ['Introduction to {subject}', 'Fundamentals of {subject}', '{subject} I', 'Principles of {subject}', 'Research Skills'],
  level5: ['Intermediate {subject}', '{subject} II', 'Applied {subject}', 'Research Methods in {subject}', 'Critical Approaches to {subject}'],
  level6: ['Advanced {subject}', '{subject} III', 'Contemporary {subject}', 'Research Project', 'Dissertation', '{subject} Practice'],
  level7: ['Advanced Topics in {subject}', '{subject} Research', 'Master\'s Project', 'Dissertation', 'Critical Practice in {subject}', 'Strategic {subject}'],
  level8: ['Doctoral Studies', 'Research Methodology', 'Advanced Research Methods', 'Thesis Development'],
};

const PSRB_BODIES = {
  ENG: 'Engineering Council', CIV: 'Joint Board of Moderators', EEE: 'IET',
  MEC: 'IMechE', PHY: 'Institute of Physics', CHM: 'Royal Society of Chemistry',
  CS:  'BCS, The Chartered Institute for IT', NUR: 'Nursing & Midwifery Council',
  PHR: 'General Pharmaceutical Council', PSY: 'British Psychological Society',
  BMS: 'IBMS', SES: 'BASES', PTY: 'CSP', PUH: 'UK Public Health Register',
  ACC: 'ICAEW / ACCA', LAW: 'Solicitors Regulation Authority',
  EDU: 'Department for Education',
  ARH: 'RIBA', ARC: 'CIfA',
};

const CURRICULUM_STAGE_DEFINITIONS = [
  ['INITIATION',       'Initial concept registered with faculty',        0],
  ['SCOPING',          'Market analysis + scoping document',             1],
  ['DEPT_APPROVAL',    'Department-level approval',                      2],
  ['FACULTY_APPROVAL', 'Faculty Board approval',                         3],
  ['ACADEMIC_REVIEW',  'Academic review with peer feedback',             4],
  ['VALIDATION_PANEL', 'External validation panel convened',             5],
  ['VALIDATION_REPORT','Validation panel report received',               6],
  ['CONDITIONS_RESPONSE', 'Conditions responded to / cleared',           7],
  ['FINAL_APPROVAL',   'Final approval by Education Committee',          8],
  ['ACADEMIC_REGISTRY','Academic Registry processing',                   9],
  ['CATALOGUE_ENTRY',  'Programme entered into catalogue + UCAS',        10],
  ['MARKETING_LAUNCH', 'Marketing collateral launched',                  11],
  ['APPLICATIONS_OPEN','Programme opens for applications',               12],
  ['IMPLEMENTED',      'First cohort enrolled',                          13],
];

function subjectNameFor(dept) { return dept.name.replace(' & ', ' and '); }

function pickRng(rng, w) { return rng.weighted(w); }

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  ctx.declare('ProgressionRule');                     // cross-domain (reference owns it)
  ctx.declare('ExternalExaminerAppointment');         // cross-domain (staff owns it)

  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const rng = ctx.rng.fork('curriculum');
  const audit = ctx.audit(now);

  const progrows = [];
  const pverRows = [];
  const pspecRows = [];
  const pstageModRows = [];
  const pexitRows = [];
  const pcontactRows = [];
  const ploRows = [];
  const pdeclRows = [];
  const psrbRows = [];
  const modRows = [];
  const mverRows = [];
  const mspecRows = [];
  const mloRows = [];
  const macRows = [];
  const iloMapRows = [];
  const progressionRules = [];
  const annualReports = [];
  const programmeReviews = [];
  const periodicReviews = [];
  const qualityActions = [];
  const curriculumMaps = [];
  const eeAppointments = [];

  // 1. Curriculum workflow (single instance covering all proposals)
  const workflowId = 'wf-curriculum-approval-v1';
  ctx.append('CurriculumWorkflow', [{
    id: workflowId, workflowType: 'PROGRAMME_APPROVAL',
    entityId: 'workflow-template',
    currentStage: 'IMPLEMENTED', status: 'TEMPLATE',
    initiatedBy: null, initiatedAt: now,
    completedAt: null, createdAt: now, updatedAt: now,
  }]);

  ctx.append('WorkflowStage', CURRICULUM_STAGE_DEFINITIONS.map(([name, , order]) => ({
    id: `ws-${name.toLowerCase()}`, workflowId, stageName: name, stageOrder: order,
    status: 'COMPLETED', assignedTo: null, decision: 'APPROVED',
    comments: null, completedAt: now, createdAt: now, updatedAt: now,
  })));

  // 2. Modules per department
  let moduleCounter = 0;
  const modulesByDept = new Map();
  for (const dept of ALL_DEPARTMENTS) {
    const deptId = ctx.ids.departmentByCode.get(dept.code).id;
    const modulesHere = [];
    // ~60 modules per department: 10 at L4, 10 L5, 10 L6 (UG), 15 L7 (PGT), 5 L3 (foundation), rest mixed
    const levelPlan = [
      ...Array(8).fill(3), ...Array(15).fill(4), ...Array(15).fill(5),
      ...Array(15).fill(6), ...Array(15).fill(7), ...Array(2).fill(8),
    ];
    for (const fheq of levelPlan) {
      moduleCounter += 1;
      const pattern = rng.pick(MODULE_NAME_PATTERNS[`level${fheq}`]);
      const title = pattern.replace('{subject}', subjectNameFor(dept));
      const code = `${dept.code}${fheq}${(moduleCounter % 1000).toString().padStart(3, '0')}`;
      const credits = fheq === 8 ? 0 : (fheq === 7 ? rng.pick([15, 20, 30, 60]) : 20);
      const moduleId = `mod-${code.toLowerCase()}`;
      const versionId = `mver-${code.toLowerCase()}-v1`;
      modRows.push({
        id: moduleId, ...audit,
        name: title, code, departmentId: deptId,
        description: `${title} — a level ${fheq} module in the ${dept.name} curriculum.`,
        credits, fheqLevel: fheq, isActive: true,
        hesaModuleId: `HM${moduleCounter.toString().padStart(6, '0')}`,
        creditLevel: fheq.toString(),
        hecosCode: dept.hecos,
        programmeSpecificationId: null,
        tenantId: ctx.tenantId,
      });
      const moduleLeaderId = ctx.ids.staffByDepartment.get(deptId)?.[moduleCounter % (ctx.ids.staffByDepartment.get(deptId)?.length ?? 1)] ?? null;
      mverRows.push({
        id: versionId, moduleId, versionNumber: 1, status: 'ACTIVE',
        code, title, credits, level: fheq.toString(),
        semester: rng.weighted([['SEM1', 40], ['SEM2', 40], ['BOTH', 15], ['FULL_YEAR', 5]]),
        moduleType: fheq < 7 ? rng.weighted([['CORE', 70], ['OPTIONAL', 30]]) : 'CORE',
        description: `${title} — synthesises core knowledge in the area through lectures, seminars and assessment.`,
        departmentId: deptId, moduleLeaderId,
        hecosCode: dept.hecos,
        prerequisites: null, corequisites: null, barredCombinations: null,
        timetablePattern: '2L+1T per week',
        deliveryLocation: 'main campus',
        maxStudents: rng.int(30, 200), minStudents: 10,
        compensationAllowed: rng.chance(0.7), condonementAllowed: rng.chance(0.5),
        readingListUrl: null,
        lectureHours: rng.int(20, 36), seminarHours: rng.int(0, 12),
        tutorialHours: rng.int(0, 8), labHours: fheq >= 5 ? rng.int(0, 24) : 0,
        fieldworkHours: 0, placementHours: 0,
        independentStudy: 100,
        anonymousMarking: true, doubleMarking: rng.chance(0.6),
        turnitinRequired: true, latePenaltyPolicy: '5% per day, zero after 7',
        createdAt: now, updatedAt: now, deletedAt: null,
      });
      mspecRows.push({
        id: `mspec-${code.toLowerCase()}`, ...audit,
        moduleId, programmeSpecId: 'pending',
        academicYearId: ctx.ids.academicYears.find(a => a.isCurrent)?.id ?? null,
        version: '1.0', credits, passCredit: 40,
        lectureHours: 24, tutorialHours: 8, practicalHours: fheq >= 5 ? 16 : 0,
        selfStudyHours: 100,
      });
      // Module learning outcomes
      const numLOs = rng.int(3, 5);
      for (let lo = 0; lo < numLOs; lo++) {
        mloRows.push({
          id: `mlo-${code.toLowerCase()}-${lo + 1}`, ...audit,
          moduleId, outcomeCode: `${code}-LO${lo + 1}`,
          description: `On successful completion, students will be able to demonstrate ${rng.pick(['knowledge of','critical understanding of','application of','analysis of','synthesis of'])} ${subjectNameFor(dept).toLowerCase()} concepts in a ${rng.pick(['professional','research','academic','practical'])} setting.`,
          bloomsLevel: rng.pick(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE']),
          assessmentMapping: null, programmeLOMapping: null,
          version: '1.0', isActive: true, sortOrder: lo + 1,
        });
      }
      // Module assessment components (2-3 per module)
      const numComponents = fheq === 8 ? 1 : rng.int(2, 3);
      let totalWeight = 100;
      for (let c = 0; c < numComponents; c++) {
        const isLast = c === numComponents - 1;
        const weight = isLast ? totalWeight : rng.int(20, Math.min(70, totalWeight - 20 * (numComponents - c - 1)));
        totalWeight -= weight;
        const type = rng.pick(ASSESSMENT_TYPES);
        macRows.push({
          id: `mac-${code.toLowerCase()}-${c + 1}`,
          moduleVersionId: versionId,
          assessmentType: type, title: `${type.replace(/_/g, ' ')} ${c + 1}`,
          weightPercent: weight,
          dueDate: null, durationMinutes: type === 'EXAM' ? 120 : null,
          wordCount: type === 'ESSAY' || type === 'COURSEWORK' ? rng.pick([1500, 2000, 2500, 3000]) : null,
          passMark: 40, resitType: 'RESUBMISSION', cappedMark: 40,
          createdAt: now, updatedAt: now, deletedAt: null,
        });
      }
      modulesHere.push({ id: moduleId, versionId, code, fheq, credits, deptId });
    }
    modulesByDept.set(deptId, modulesHere);
    ctx.ids.moduleByDepartment.set(deptId, modulesHere.map(m => m.id));
    ctx.ids.moduleIds.push(...modulesHere.map(m => ({ id: m.id, versionId: m.versionId, code: m.code, deptId, fheq: m.fheq })));
  }

  // 3. Programmes per department — distribute ~600 across 48 depts (so ~12-13 each)
  const targetProgrammesPerDept = 13;
  let progSeq = 0;
  for (const dept of ALL_DEPARTMENTS) {
    const deptId = ctx.ids.departmentByCode.get(dept.code).id;
    const facultyId = ctx.ids.facultyByCode.get(dept.facultyCode).id;
    for (let i = 0; i < targetProgrammesPerDept; i++) {
      progSeq += 1;
      const type = rng.weighted(PROGRAMME_TYPES_WEIGHTED);
      const t = PROG_TYPE_DETAILS[type];
      if (!t) continue;
      const ucasCode = type.startsWith('B') || type === 'LLB' || type === 'FDA' || type === 'MENG'
        ? `${rng.pick(['A','B','C','D','E','F','G','H','M','N'])}${rng.int(100, 999)}` : null;
      const progId = `prog-${dept.code.toLowerCase()}-${progSeq.toString().padStart(4, '0')}`;
      const programmeName = `${t.award} ${subjectNameFor(dept)}${type === 'MBA' ? '' : ''}`;
      const code = `${dept.code}${type}${(i + 1).toString().padStart(2, '0')}`;
      progrows.push({
        id: progId, ...audit,
        name: programmeName, code, facultyId, departmentId: deptId,
        awardingBody: 'Future Horizons University',
        nqfLevel: t.fheq.toString(), fheqLevel: t.fheq.toString(),
        duration: t.duration,
        modeOfStudy: rng.weighted([['FULL_TIME', 70], ['PART_TIME', 25], ['DISTANCE', 5]]),
        isActive: true,
        description: `${programmeName} — a ${t.duration}-month programme delivered by the ${dept.name}.`,
        hesaCourseId: `HC${progSeq.toString().padStart(6, '0')}`,
        courseAim: t.hesaAim, hecosCode1: dept.hecos, hecosCode2: null,
        hecosPercentage1: 100, hecosPercentage2: null,
        ttcid: null, tenantId: ctx.tenantId,
      });

      // ProgrammeVersion — current + 1 historical
      for (let v = 1; v <= 2; v++) {
        const verId = `pver-${progId.slice(5)}-v${v}`;
        const isActive = v === 2;
        pverRows.push({
          id: verId, programmeId: progId, versionNumber: v,
          status: isActive ? 'ACTIVE' : 'WITHDRAWN',
          validFrom: ayStartDate(ACADEMIC_YEARS[isActive ? 4 : 1]) + 'T00:00:00Z',
          validTo: isActive ? null : ayStartDate(ACADEMIC_YEARS[4]) + 'T00:00:00Z',
          title: programmeName, routeCode: code,
          ucasCode, level: t.fheq.toString(),
          totalCredits: t.credits, fheqLevel: t.fheq,
          durationFT: t.duration, durationPT: t.duration * 2,
          programmeType: type, creditFramework: 'FHEQ',
          teachingLanguage: 'English',
          hecosCode: dept.hecos, jacsCode: null, cahCode: null,
          psrbAccredited: !!PSRB_BODIES[dept.code], partnershipFlag: false, partnerInstitution: null,
          ofsConditionB3: true, tneIndicator: false,
          firstDeliveryDate: ayStartDate(ACADEMIC_YEARS[1]) + 'T00:00:00Z',
          suspensionDate: null, withdrawalDate: isActive ? null : ayStartDate(ACADEMIC_YEARS[4]) + 'T00:00:00Z',
          aims: `To prepare graduates with deep ${subjectNameFor(dept).toLowerCase()} knowledge for a ${rng.pick(['research','practice','industry','professional'])} career.`,
          employabilityStatement: 'Graduates progress to research, professional practice, or industry roles aligned with the discipline.',
          qaaBenchmark: dept.name, graduateAttributes: 'Critical thinking, research literacy, ethical reasoning, professional communication.',
          psrbRequirements: PSRB_BODIES[dept.code] ?? null,
          teachingMethods: 'Lectures, seminars, tutorials, labs (where applicable), independent study.',
          assessmentStrategy: 'Mix of examination, coursework, presentation and project.',
          feedbackTurnaround: '15 working days', moderationPolicy: 'Standard internal + external moderation',
          anonymousMarking: true, inclusiveAssessment: 'Available on request',
          academicIntegrity: 'Turnitin enabled on all submissions',
          hasFoundationYear: type === 'FDA', hasPlacementYear: false,
          hasIntegratedMasters: type === 'MENG',
          eiaCompleted: true, eiaDetails: null, marketAnalysis: null, resourceConfirmation: null,
          employerEngagement: null, sustainabilityGoals: null, additionalCosts: null, regulations: null,
          facultyId, schoolId: null, departmentId: deptId,
          programmeLeaderId: ctx.ids.staffByDepartment.get(deptId)?.[0] ?? null,
          createdAt: now, updatedAt: now, deletedAt: null,
        });

        // ProgrammeStageModule — link modules to stages
        const stages = type.startsWith('B') || type === 'LLB' ? 3 : type === 'MENG' ? 4 : type === 'MSC' || type === 'MA' || type === 'MBA' || type === 'LLM' || type === 'MRES' ? 1 : 0;
        const deptModules = modulesByDept.get(deptId) ?? [];
        for (let stage = 1; stage <= stages; stage++) {
          const fheqStage = t.fheq - (stages - stage);
          const relevant = deptModules.filter(m => m.fheq === fheqStage);
          const chosen = relevant.length ? rng.pickN(relevant, Math.min(relevant.length, 8)) : [];
          chosen.forEach((m, idx) => {
            pstageModRows.push({
              id: `psm-${verId.slice(5)}-s${stage}-${idx + 1}`,
              programmeVersionId: verId, moduleVersionId: m.versionId,
              stageLevel: stage.toString(), moduleCode: m.code,
              moduleTitle: modRows.find(r => r.id === m.id)?.name ?? m.code,
              credits: m.credits, moduleType: idx < 5 ? 'CORE' : 'OPTIONAL',
              semester: rng.weighted([['SEM1', 45], ['SEM2', 45], ['BOTH', 10]]),
              status: 'ACTIVE',
              createdAt: now, updatedAt: now, deletedAt: null,
            });
          });
          // Programme contact hours per stage
          pcontactRows.push({
            id: `pch-${verId.slice(5)}-s${stage}`,
            programmeVersionId: verId, stageLevel: stage.toString(),
            lectures: 144, seminars: 48, tutorials: 24,
            labPractical: t.level === 'UG' && dept.facultyCode === 'SEN' || dept.facultyCode === 'HLS' ? 96 : 0,
            fieldwork: 0, placement: 0,
            independentStudy: 800,
          });
          // ProgressionRule per stage transition
          if (stage < stages) {
            progressionRules.push({
              id: `pr-${verId.slice(5)}-s${stage}-s${stage + 1}`,
              programmeVersionId: verId, fromLevel: t.fheq - (stages - stage),
              toLevel: t.fheq - (stages - stage) + 1,
              ruleText: `Pass 120 credits at FHEQ level ${t.fheq - (stages - stage)} (compensation may apply per Academic Regulations).`,
              ruleType: 'STANDARD',
            });
          }
        }

        // ProgrammeSpecification
        pspecRows.push({
          id: `pspec-${verId.slice(5)}`, ...audit,
          programmeId: progId,
          academicYearId: ctx.ids.academicYears.find(a => a.isCurrent)?.id ?? null,
          version: `${v}.0`, credits: t.credits, passCredit: 40,
          classificationRules: 'Standard UK classification: weighted by L5×0.3 + L6×0.7',
          validFrom: ayStartDate(ACADEMIC_YEARS[isActive ? 4 : 1]) + 'T00:00:00Z',
          validTo: isActive ? null : ayStartDate(ACADEMIC_YEARS[4]) + 'T00:00:00Z',
        });

        // ProgrammeDeclaration (only on active version)
        if (isActive) {
          pdeclRows.push({
            id: `pdecl-${verId.slice(5)}`,
            programmeVersionId: verId, role: 'PROGRAMME_LEADER',
            declarantName: 'Programme Leader', declared: true, declaredAt: now,
          });
        }

        // ProgrammeExitAward (UG only — intermediate cert/dip/exit)
        if (t.level === 'UG' && stages >= 3) {
          pexitRows.push({
            id: `pexit-${verId.slice(5)}-certhe`,
            programmeVersionId: verId, awardName: `CertHE ${subjectNameFor(dept)}`,
            creditsRequired: 120, enabled: true, deletedAt: null,
          });
          pexitRows.push({
            id: `pexit-${verId.slice(5)}-diphe`,
            programmeVersionId: verId, awardName: `DipHE ${subjectNameFor(dept)}`,
            creditsRequired: 240, enabled: true, deletedAt: null,
          });
        }

        // PSRB accreditation if applicable
        if (PSRB_BODIES[dept.code] && isActive) {
          psrbRows.push({
            id: `psrb-${verId.slice(5)}`,
            programmeVersionId: verId, bodyName: PSRB_BODIES[dept.code],
            accreditationType: 'PROFESSIONAL', currentStatus: 'CURRENT',
            nextReviewDate: '2028-08-01T00:00:00Z',
          });
        }
      }

      // Programme learning outcomes
      const numPLOs = rng.int(5, 8);
      for (let plo = 0; plo < numPLOs; plo++) {
        ploRows.push({
          id: `plo-${progId.slice(5)}-${plo + 1}`, ...audit,
          programmeId: progId, outcomeCode: `${code}-PLO${plo + 1}`,
          category: rng.pick(['KNOWLEDGE', 'SKILLS', 'COMPETENCIES', 'VALUES']),
          description: `Demonstrate ${rng.pick(['critical understanding of','advanced application of','analytical command of','professional practice in','independent research in'])} ${subjectNameFor(dept).toLowerCase()}.`,
          bloomsLevel: rng.pick(['UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE']),
          fheqAlignment: t.fheq.toString(),
          assessmentMethod: null, moduleMapping: null,
          academicYearId: null, version: '1.0', isActive: true, sortOrder: plo + 1,
        });
      }

      // Annual programme report (one per AY × 5)
      ACADEMIC_YEARS.slice(0, 5).forEach((ay) => {
        annualReports.push({
          id: `apr-${progId.slice(5)}-${ay.replace('/', '')}`, ...audit,
          programmeId: progId, academicYearId: ctx.ids.academicYearIdByLabel.get(ay),
          status: 'APPROVED', authorName: 'Programme Leader', authorRole: 'PROGRAMME_LEADER',
          enrolmentData: null, retentionData: null, achievementData: null,
          nssScores: null, employabilityData: null, externalExaminerSummary: null,
          studentFeedback: null, curriculumChanges: null,
          goodPractice: 'Strong external examiner endorsement; high student satisfaction in module evaluations.',
          areasForImprovement: 'Continued effort on consistent marker feedback turnaround.',
          actionItems: null, submittedAt: now, reviewedAt: now,
        });
      });

      // Programme review (one historical per programme)
      programmeReviews.push({
        id: `prev-${progId.slice(5)}`, ...audit,
        programmeId: progId, reviewDate: ayStartDate(ACADEMIC_YEARS[2]) + 'T00:00:00Z',
        reviewType: 'ANNUAL', reviewerName: 'External Examiner',
        findings: 'Programme operating as approved.', recommendations: 'Continue annual review cycle.',
        overallRating: rng.pick(['EXCELLENT', 'GOOD', 'SATISFACTORY']),
      });

      // Periodic review (every 5 years)
      periodicReviews.push({
        id: `pdr-${progId.slice(5)}`, ...audit,
        programmeId: progId, reviewType: 'PERIODIC', status: 'COMPLETED',
        scheduledDate: ayStartDate(ACADEMIC_YEARS[1]) + 'T00:00:00Z',
        completedDate: ayStartDate(ACADEMIC_YEARS[2]) + 'T00:00:00Z',
        nextReviewDate: ayStartDate('2026/27') + 'T00:00:00Z',
        reviewPeriod: '2020-2025',
        selfEvaluation: null, studentData: null, externalInput: null,
        panelFindings: 'Programme meets all academic standards.',
        actionPlan: null, outcome: 'CONTINUED',
      });

      // CurriculumMap (one per programme)
      curriculumMaps.push({
        id: `cmap-${progId.slice(5)}`, ...audit,
        programmeId: progId,
        academicYearId: ctx.ids.academicYears.find(a => a.isCurrent)?.id ?? null,
        version: '1.0',
        mappingData: JSON.stringify({ stages: 3, modules: 30, plos: numPLOs }),
        coverageAnalysis: 'Full PLO coverage across stages.', isActive: true,
      });

      // ExternalExaminerAppointment — assign an examiner from the same subject
      const matchingExaminers = ctx.ids.examinerIds.filter(e => e.departmentCode === dept.code);
      if (matchingExaminers.length) {
        const ex = rng.pick(matchingExaminers);
        eeAppointments.push({
          id: `eea-${progId.slice(5)}`, ...audit,
          examinerId: ex.id, programmeId: progId,
          appointmentDate: ayStartDate(ACADEMIC_YEARS[2]) + 'T00:00:00Z',
          endDate: ayStartDate(ACADEMIC_YEARS[6]) + 'T00:00:00Z',
          termOfOffice: 4,
        });
      }

      ctx.ids.programmeIds.push({
        id: progId, code, departmentId: deptId, facultyId,
        type, fheq: t.fheq, level: t.level, duration: t.duration, credits: t.credits,
        ucasCode, name: programmeName,
      });
    }
  }

  // ILO Module Mapping — link each programme LO to modules that address it
  for (const plo of ploRows) {
    const progDeptId = progrows.find(p => p.id === plo.programmeId)?.departmentId;
    if (!progDeptId) continue;
    const deptModules = modulesByDept.get(progDeptId) ?? [];
    const sample = rng.pickN(deptModules, Math.min(3, deptModules.length));
    for (const m of sample) {
      iloMapRows.push({
        id: `ilo-${plo.id.slice(4)}-${m.code.toLowerCase()}`,
        programmeLearningOutcomeId: plo.id,
        moduleVersionId: m.versionId,
        mappingLevel: rng.pick(['INTRODUCED', 'DEVELOPED', 'ASSESSED']),
      });
    }
  }

  // 4. Quality actions
  for (let q = 0; q < 1000; q++) {
    qualityActions.push({
      id: `qa-${(q + 1).toString().padStart(4, '0')}`, ...audit,
      actionDescription: rng.pick([
        'Update programme handbook for inclusive language',
        'Schedule external examiner refresh',
        'Add new assessment criteria for sustainability',
        'Review reading list for currency',
        'Increase formative feedback opportunities',
      ]),
      targetDate: ayStartDate(rng.pick(ACADEMIC_YEARS.slice(3, 6))) + 'T00:00:00Z',
      completionDate: rng.chance(0.7) ? ayStartDate(rng.pick(ACADEMIC_YEARS.slice(3, 6))) + 'T00:00:00Z' : null,
      owner: 'Programme Leader',
      status: rng.weighted([['COMPLETED', 70], ['IN_PROGRESS', 20], ['OPEN', 10]]),
    });
  }

  // 5. Sample curriculum approval proposals (~150)
  const proposalRows = [];
  const stageHistoryRows = [];
  const approvalGateRows = [];
  const commentRows = [];
  const documentRows = [];
  const panelMemberRows = [];
  const conditionRows = [];
  const proposedModRows = [];
  const proposedLORows = [];
  for (let p = 0; p < 150; p++) {
    const dept = rng.pick(ALL_DEPARTMENTS);
    const facultyId = ctx.ids.facultyByCode.get(dept.facultyCode).id;
    const deptId = ctx.ids.departmentByCode.get(dept.code).id;
    const isInflight = p < 50;
    const propId = `cp-${(p + 1).toString().padStart(4, '0')}`;
    const currentStage = isInflight
      ? rng.pick(CURRICULUM_STAGE_DEFINITIONS.slice(2, 10))[0]
      : 'IMPLEMENTED';
    const status = isInflight ? 'IN_REVIEW' : 'APPROVED';
    proposalRows.push({
      id: propId, ...audit,
      proposalRef: `CP-${(2026000 + p + 1).toString()}`,
      title: `New ${rng.pick(['BSc','MSc','MA'])} ${subjectNameFor(dept)}`,
      proposalType: 'NEW_PROGRAMME',
      status, currentStage,
      facultyId, departmentId: deptId, programmeId: null,
      proposerId: 'staff-prog-leader', proposerName: 'Programme Leader',
      proposerEmail: `programme.leader@fhe.ac.uk`,
      rationale: 'New programme to address growing market demand and align with strategic priorities.',
      marketAnalysis: 'Strong UCAS interest in adjacent programmes.',
      resourceImplications: 'Three new lecturer posts required.',
      financialCase: 'Breaks even in year 3.',
      targetStartDate: ayStartDate('2026/27') + 'T00:00:00Z',
      ucasCode: null, hecosCode: dept.hecos, proposedAward: 'BSc (Hons)',
      proposedLevel: '6', proposedCredits: 360, proposedDuration: 36, proposedMode: 'FT',
      accreditationBody: PSRB_BODIES[dept.code] ?? null,
      submittedAt: now, approvedAt: isInflight ? null : now,
      rejectedAt: null, n8nWorkflowId: workflowId,
    });
    // Stage history through current stage
    const stageIndex = CURRICULUM_STAGE_DEFINITIONS.findIndex(s => s[0] === currentStage);
    for (let s = 0; s <= stageIndex; s++) {
      const [from, , ] = CURRICULUM_STAGE_DEFINITIONS[s];
      const [to, , ] = CURRICULUM_STAGE_DEFINITIONS[s + 1] ?? CURRICULUM_STAGE_DEFINITIONS[s];
      stageHistoryRows.push({
        id: `csh-${propId.slice(3)}-s${s}`, ...audit,
        proposalId: propId, fromStage: from, toStage: to,
        transitionedBy: 'staff-prog-leader', transitionedByName: 'Programme Leader',
        notes: null, decision: 'APPROVED',
      });
    }
    // Approval gates (key ones)
    ['DEPT_APPROVAL', 'FACULTY_APPROVAL', 'VALIDATION_PANEL', 'FINAL_APPROVAL'].forEach((gate, idx) => {
      approvalGateRows.push({
        id: `cag-${propId.slice(3)}-${gate.toLowerCase()}`, ...audit,
        proposalId: propId, gateName: gate, gateOrder: idx + 1,
        committeeId: null, committeeName: gate === 'FINAL_APPROVAL' ? 'Education Committee' : null,
        status: stageIndex > CURRICULUM_STAGE_DEFINITIONS.findIndex(s => s[0] === gate) ? 'APPROVED' : 'PENDING',
        reviewerName: 'Committee Chair', reviewerEmail: 'committee.chair@fhe.ac.uk',
        reviewDate: now, comments: null, conditions: null,
        conditionsMet: true, conditionsMetDate: now,
      });
    });
    // Comments
    commentRows.push({
      id: `cc-${propId.slice(3)}-1`, ...audit,
      proposalId: propId, authorName: 'Reviewer', authorEmail: 'reviewer@fhe.ac.uk',
      authorRole: 'PEER_REVIEWER',
      content: 'Strong rationale; recommend approval subject to resource confirmation.',
      commentType: 'REVIEW', isInternal: true, parentId: null,
    });
    // Documents
    documentRows.push({
      id: `cd-${propId.slice(3)}-spec`, ...audit,
      proposalId: propId, periodicReviewId: null, annualReportId: null,
      documentType: 'PROGRAMME_SPEC', title: 'Programme Specification draft',
      fileName: `${propId}-spec-v1.pdf`,
      fileUrl: `minio://documents/curriculum/${propId}-spec-v1.pdf`,
      fileSize: 145_000, mimeType: 'application/pdf',
      version: '1.0', uploadedByName: 'Programme Leader',
    });
    // Panel members
    for (let m = 0; m < 4; m++) {
      panelMemberRows.push({
        id: `vpm-${propId.slice(3)}-${m + 1}`, ...audit,
        proposalId: propId,
        memberName: `Panel Member ${m + 1}`,
        memberEmail: `panel.${propId}.${m + 1}@external.ac.uk`,
        memberRole: m === 0 ? 'CHAIR' : 'MEMBER',
        institution: rng.pick(['University of Manchester', 'University of Leeds', 'University of Sheffield']),
        expertise: subjectNameFor(dept),
        confirmed: true, confirmedDate: now,
        panelReport: 'Panel endorses approval.',
      });
    }
    // Conditions (~2 per proposal)
    if (rng.chance(0.4)) {
      conditionRows.push({
        id: `ac-${propId.slice(3)}-1`, ...audit,
        proposalId: propId, conditionType: 'RESOURCING',
        description: 'Confirm three lecturer posts before launch.',
        deadline: ayStartDate('2026/27') + 'T00:00:00Z',
        status: 'MET', responseText: 'Posts approved by HR.', responseDate: now,
        reviewedBy: 'staff-pvc-educ', reviewedByName: 'PVC Education', reviewDate: now,
      });
    }
    // Proposed modules
    for (let pm = 0; pm < rng.int(1, 3); pm++) {
      proposedModRows.push({
        id: `pm-${propId.slice(3)}-${pm + 1}`, ...audit,
        proposalId: propId, existingModuleId: null,
        proposedCode: `${dept.code}NEW${pm + 1}`,
        title: `New module ${pm + 1}`, credits: 20, level: 6,
        semester: 'SEM1', moduleType: 'CORE',
        description: 'New core module to support the proposed programme.',
        learningOutcomes: null, assessmentStrategy: null, teachingMethods: null,
        contactHours: 48, selfStudyHours: 152,
        prerequisiteIds: null, corequisiteIds: null,
        isNew: true, moduleLeader: 'Module Leader', sortOrder: pm + 1,
      });
    }
    // Proposed learning outcomes
    for (let plo = 0; plo < rng.int(3, 6); plo++) {
      proposedLORows.push({
        id: `plo-prop-${propId.slice(3)}-${plo + 1}`, ...audit,
        proposalId: propId, outcomeCode: `${propId}-PLO${plo + 1}`,
        category: 'KNOWLEDGE',
        description: 'Students will be able to demonstrate critical understanding of the subject.',
        bloomsLevel: 'UNDERSTAND', fheqAlignment: '6',
        assessmentMethod: null, moduleMapping: null, sortOrder: plo + 1,
      });
    }
  }

  // Append everything
  ctx.append('Programme', progrows);
  ctx.append('ProgrammeVersion', pverRows);
  ctx.append('ProgrammeSpecification', pspecRows);
  ctx.append('ProgrammeStageModule', pstageModRows);
  ctx.append('ProgrammeExitAward', pexitRows);
  ctx.append('ProgrammeContactHours', pcontactRows);
  ctx.append('ProgrammeLearningOutcome', ploRows);
  ctx.append('ProgrammeDeclaration', pdeclRows);
  ctx.append('PSRBAccreditation', psrbRows);
  ctx.append('Module', modRows);
  ctx.append('ModuleVersion', mverRows);
  ctx.append('ModuleSpecification', mspecRows);
  ctx.append('ModuleLearningOutcome', mloRows);
  ctx.append('ModuleAssessmentComponent', macRows);
  ctx.append('ILOModuleMapping', iloMapRows);
  ctx.append('ProgressionRule', progressionRules);
  ctx.append('AnnualProgrammeReport', annualReports);
  ctx.append('ProgrammeReview', programmeReviews);
  ctx.append('PeriodicReview', periodicReviews);
  ctx.append('QualityAction', qualityActions);
  ctx.append('CurriculumMap', curriculumMaps);
  ctx.append('ExternalExaminerAppointment', eeAppointments);
  ctx.append('CurriculumProposal', proposalRows);
  ctx.append('CurriculumStageHistory', stageHistoryRows);
  ctx.append('CurriculumApprovalGate', approvalGateRows);
  ctx.append('CurriculumComment', commentRows);
  ctx.append('CurriculumDocument', documentRows);
  ctx.append('ValidationPanelMember', panelMemberRows);
  ctx.append('ApprovalCondition', conditionRows);
  ctx.append('ProposedModule', proposedModRows);
  ctx.append('ProposedLearningOutcome', proposedLORows);

  ctx.log(domain,
    `${progrows.length} programmes, ${pverRows.length} versions, ${modRows.length} modules, ${mverRows.length} module versions, ${ploRows.length} PLOs, ${mloRows.length} MLOs, ${macRows.length} assessment components, ${pstageModRows.length} stage→module links, ${proposalRows.length} curriculum proposals`);
}
