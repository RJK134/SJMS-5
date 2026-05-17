/**
 * students generator (D6) — the largest single domain by volume.
 *
 * Volumes (target):
 *   Student                      40,000 active + 12,000 alumni = 52,000
 *   Enrolment                  ~120,000 (avg 2.3 years per student)
 *   ModuleRegistration         ~600,000 (5 per enrolment)
 *   StudyAim                    ~52,000 (one per student)
 *   StudentInstance            ~120,000 (one per enrolment)
 *   InstancePeriod             ~120,000
 *   EnrolmentOccurrence        ~120,000
 *   ProgrammeOccurrence          ~3,000 (programme × AY × intake)
 *   StudentStatusHistory       ~150,000
 *   ModeOfStudyHistory          ~10,000 (~8% change mode)
 *   InterruptionEvent            ~5,000
 *   TransferEvent                ~2,500
 *   CompletionEvent             ~12,000 (alumni)
 *   WithdrawalEvent              ~8,000 (15% over 5 years)
 *   PersonalTutorAllocation    ~120,000 (one per student-year)
 *   TutorAssignment            ~120,000
 *   TutoringMeeting            ~360,000 (~3 per allocation)
 *   StaffModuleAssignment       ~12,000 (3,000 modules × 4 years of teaching assignments)
 *   ApprenticeshipRegistration   ~2,000 (~5% UG cohort)
 *   ApprenticeshipEmployer         ~600 (employers across the cohort)
 *   ApprenticeshipOtjRecord     ~40,000 (~20 per registration)
 *   ApprenticeshipGateway        ~2,000 (one per registration)
 *   ApprenticeshipEpa              ~500 (graduating apprentices)
 *   EnrolmentWorkflow / Stage    ~40,000 / ~200,000 (one workflow per current enrolment)
 *
 * Plus Person family for 52k new persons: ~470k more PII rows.
 *
 * Cross-domain back-fill:
 *   CoCurricularRecord (governance) — ~12,000 (30% of students log activities)
 *   StudentOrgMembership (governance) — ~50,000 (~40% of students)
 *
 * Total: ~2.4M rows. Generation should complete in <30s.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import {
  FIRST_NAMES, LAST_NAMES, GENDERS_WEIGHTED, ETHNICITY_WEIGHTED, DISABILITY_WEIGHTED,
  DOMICILES_WEIGHTED, FEE_STATUS_WEIGHTED, POLAR_QUINTILES_WEIGHTED, POSTCODE_AREAS,
  STUDENT_LEVELS_WEIGHTED, UG_MODE_WEIGHTED, UG_AGE_AT_ENROLMENT_MEAN,
  UG_AGE_AT_ENROLMENT_STDDEV, PGT_AGE_AT_ENROLMENT_MEAN, PGT_AGE_AT_ENROLMENT_STDDEV,
  PGR_AGE_AT_ENROLMENT_MEAN, PGR_AGE_AT_ENROLMENT_STDDEV,
} from '../lib/uk-demographics.mjs';
import { ACADEMIC_YEARS, ayStartDate, ayEndDate, CURRENT_ACTIVE_YEAR } from '../lib/academic-calendar.mjs';
import { createPerson } from '../lib/person-factory.mjs';

export const domain = 'students';

const ACTIVE_STUDENTS = 40_000;
const ALUMNI = 12_000;
const MODULES_PER_ENROLMENT = 6;
const APPRENTICE_FRACTION = 0.05;       // ~5% of UG are apprentices
const ORG_MEMBERSHIP_FRACTION = 0.40;
const COCURRICULAR_FRACTION = 0.30;

const APPRENTICESHIP_STANDARDS = [
  ['ST0125', 'Digital and Technology Solutions Professional', 6],
  ['ST0480', 'Solicitor', 7],
  ['ST0001', 'Accountancy Professional', 7],
  ['ST0220', 'Healthcare Assistant Practitioner', 5],
  ['ST0010', 'Senior Leader Master\'s Degree Apprenticeship', 7],
  ['ST0468', 'Senior People Professional', 7],
  ['ST0181', 'Manufacturing Engineer', 6],
];

const EMPLOYERS = [
  'NHS Trust', 'EY UK', 'Deloitte UK', 'PwC UK', 'KPMG UK', 'Accenture UK',
  'BT Group', 'Capgemini', 'CGI UK', 'BAE Systems', 'Rolls-Royce',
  'Jaguar Land Rover', 'Network Rail', 'Highways England', 'HMRC',
  'Department for Work and Pensions', 'Cabinet Office', 'Local Council',
  'Lloyds Banking Group', 'Barclays', 'HSBC UK', 'Santander UK',
];

function pickName(rng) { return { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES) }; }

function genderToHesaSex(g) {
  return ({ MALE: '1', FEMALE: '2', OTHER: '3', PREFER_NOT_TO_SAY: '4' })[g] ?? '4';
}

function dobForAge(rng, mean, stddev, asOfYear) {
  const age = Math.max(17, Math.min(60, Math.round(rng.gauss(mean, stddev))));
  return new Date(Date.UTC(asOfYear - age, rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10);
}

function generateHusid(rng, seq) {
  // 13-digit + 1 check digit; here a deterministic synthesis
  const base = (2000000000000 + seq).toString().slice(-13);
  const checkDigit = base.split('').reduce((s, d) => s + parseInt(d, 10), 0) % 10;
  return base + checkDigit;
}

function studentAddress(rng, idx) {
  const num = (idx % 999) + 1;
  const street = rng.pick(['Student Way', 'College Lane', 'Campus Road', 'Park Avenue', 'High Street']);
  const area = rng.pick(POSTCODE_AREAS);
  return {
    line1: `${num} ${street}`, line2: null, line3: null,
    city: rng.pick(['Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Sheffield',
      'Newcastle', 'Bristol', 'Cardiff', 'Edinburgh', 'Reading', 'Brighton', 'York']),
    county: null,
    postcode: `${area}${rng.int(1, 9)} ${rng.int(1, 9)}${rng.pick(['AA','AB','BB','CD'])}`,
    country: 'United Kingdom', countryCode: 'GB',
  };
}

function feeStatusFromDomicile(domicile, rng) {
  if (domicile.startsWith('GB')) return 'HOME';
  if (['IE'].includes(domicile)) return 'HOME';
  return rng.weighted([['OVERSEAS', 90], ['EU_REINSTATED', 10]]);
}

function fundingSourceForFeeStatus(feeStatus, rng) {
  if (feeStatus === 'HOME') return rng.weighted([['SLC', 75], ['SELF_FUNDED', 15], ['SPONSORED', 10]]);
  return rng.weighted([['SELF_FUNDED', 70], ['SPONSORED', 25], ['SCHOLARSHIP', 5]]);
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  ctx.declare('CoCurricularRecord');           // cross-domain (governance owns it)
  ctx.declare('StudentOrgMembership');         // cross-domain (governance owns it)

  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('students');

  const stRows = [];
  const enRows = [];
  const mrRows = [];
  const sahRows = [];
  const saRows = [];
  const siRows = [];
  const ipRows = [];
  const eoRows = [];
  const poRows = [];
  const moshRows = [];
  const intRows = [];
  const trRows = [];
  const cpRows = [];
  const wdRows = [];
  const ptaRows = [];
  const taRows = [];
  const tmRows = [];
  const smaRows = [];
  const apRegRows = [];
  const apEmpRows = [];
  const apOtjRows = [];
  const apGwRows = [];
  const apEpaRows = [];
  const ewRows = [];
  const ewsRows = [];
  const ccRows = [];
  const somRows = [];

  // 1. ProgrammeOccurrence — one row per (programme × AY × intake) for active programmes
  const programmeOccByKey = new Map();
  for (const p of ctx.ids.programmeIds) {
    for (const ay of ACADEMIC_YEARS.slice(0, 6)) {
      const id = `po-${p.id.slice(5)}-${ay.replace('/', '')}`;
      programmeOccByKey.set(`${p.id}|${ay}`, id);
      poRows.push({
        id, ...audit,
        programmeId: p.id,
        academicYearId: ctx.ids.academicYearIdByLabel.get(ay),
        intakeMonth: 9, maxPlaces: p.level === 'UG' ? 250 : 60,
        currentPlaces: 0, isActive: true,
      });
    }
  }
  ctx.append('ProgrammeOccurrence', poRows);

  // 2. Apprenticeship employers (~50)
  const employerIds = [];
  for (let e = 0; e < 50; e++) {
    const id = `apemp-${(e + 1).toString().padStart(3, '0')}`;
    employerIds.push(id);
    apEmpRows.push({
      id, createdAt: now, updatedAt: now, deletedAt: null,
      name: rng.pick(EMPLOYERS) + ' ' + (e + 1),
      contactName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      contactEmail: `apprenticeships+${e}@employer.example.com`,
      contactPhone: `020 ${rng.int(7000, 8999)} ${rng.int(1000, 9999)}`,
      address: `${rng.int(1, 200)} Business Park`,
      postcode: `${rng.pick(POSTCODE_AREAS)}${rng.int(1, 9)} ${rng.int(1, 9)}AA`,
      levyPayer: rng.chance(0.7), edrsNumber: `EDRS${rng.int(100000, 999999)}`,
      contractRef: `CR-${(e + 1).toString().padStart(4, '0')}`,
    });
  }
  ctx.append('ApprenticeshipEmployer', apEmpRows);

  function emitStudent(seq, opts) {
    const { first, last } = pickName(rng);
    const studentNumber = `STU-${(2020000 + seq).toString()}`;
    const isAlumni = opts.isAlumni;
    const level = opts.level ?? rng.weighted(STUDENT_LEVELS_WEIGHTED);
    const ageMean = level === 'UG' ? UG_AGE_AT_ENROLMENT_MEAN :
                    level === 'PGT' ? PGT_AGE_AT_ENROLMENT_MEAN : PGR_AGE_AT_ENROLMENT_MEAN;
    const ageStd = level === 'UG' ? UG_AGE_AT_ENROLMENT_STDDEV :
                   level === 'PGT' ? PGT_AGE_AT_ENROLMENT_STDDEV : PGR_AGE_AT_ENROLMENT_STDDEV;
    const enrolmentYear = isAlumni
      ? rng.int(2017, 2021)
      : (level === 'UG' ? rng.int(2022, 2025) : rng.int(2024, 2025));
    const dob = dobForAge(rng, ageMean, ageStd, enrolmentYear);
    const gender = rng.weighted(GENDERS_WEIGHTED);
    const ethnicity = rng.weighted(ETHNICITY_WEIGHTED);
    const disability = rng.weighted(DISABILITY_WEIGHTED);
    const domicile = rng.weighted(DOMICILES_WEIGHTED);
    const nationality = domicile.startsWith('GB') ? 'GB' : domicile;
    const feeStatus = feeStatusFromDomicile(domicile, rng);
    const studentId = `stu-${studentNumber.toLowerCase()}`;
    const husid = generateHusid(rng, seq);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${seq}@student.fhe.ac.uk`;
    const address = studentAddress(rng, seq);

    const { personId } = createPerson(ctx, {
      role: 'student', firstName: first, lastName: last, title: null,
      dateOfBirth: dob, gender, hesaSexId: genderToHesaSex(gender),
      email, phone: `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      nationalityCode: nationality, address,
      createdAt: now, effectiveFrom: ayStartDate(`${enrolmentYear}/${(enrolmentYear + 1).toString().slice(2)}`) + 'T00:00:00Z',
    });

    // Pick a programme at the right level
    const candidatePrograms = ctx.ids.programmeIds.filter(p => p.level === level);
    const prog = rng.pick(candidatePrograms);
    const mode = level === 'UG' ? rng.weighted(UG_MODE_WEIGHTED) : 'FULL_TIME';

    stRows.push({
      id: studentId, ...audit,
      studentNumber, firstName: first, middleNames: null, lastName: last,
      dateOfBirth: dob + 'T00:00:00Z',
      gender, ethnicity, disability,
      religion: null, sexualOrientation: null, genderIdentity: gender,
      email, alternativeEmail: null,
      phone: null,
      mobilePhone: `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      address: address.line1, city: address.city, postcode: address.postcode,
      country: address.country, countryOfOrigin: domicile, nationalityCode: nationality,
      husid, numhus: husid.slice(0, 13),
      feeEligibility: feeStatus, majorFeeSource: fundingSourceForFeeStatus(feeStatus, rng),
      domicile, hesaSexId: genderToHesaSex(gender),
      qualificationOnEntry: level === 'UG' ? 'A_LEVEL' : 'BACHELOR_DEGREE',
      userId: null, personId, tenantId: ctx.tenantId,
    });

    ctx.ids.studentIds.push({
      id: studentId, personId, programmeId: prog.id, level,
      fee: feeStatus, mode, husid, isAlumni,
    });

    // StudyAim — one per student (covers their programme of study)
    const studyAimId = `sa-${studentId.slice(4)}`;
    const aimEndYear = enrolmentYear + (level === 'UG' ? 3 : level === 'PGT' ? 1 : 3);
    saRows.push({
      id: studyAimId, ...audit,
      studentId, programmeId: prog.id,
      hesaCourseId: `HC${seq.toString().padStart(6, '0')}`,
      courseAim: 'F40',
      startDate: ayStartDate(`${enrolmentYear}/${(enrolmentYear + 1).toString().slice(2)}`) + 'T00:00:00Z',
      expectedEndDate: ayEndDate(`${aimEndYear - 1}/${aimEndYear.toString().slice(2)}`) + 'T00:00:00Z',
      actualEndDate: isAlumni ? ayEndDate(`${aimEndYear - 1}/${aimEndYear.toString().slice(2)}`) + 'T00:00:00Z' : null,
      isActive: !isAlumni,
    });

    // Enrolment per AY the student was/is active
    const yearsHistory = isAlumni
      ? (level === 'UG' ? 3 : level === 'PGT' ? 1 : 3)
      : Math.min(level === 'UG' ? rng.int(1, 4) : level === 'PGT' ? 1 : rng.int(1, 3),
                 2026 - enrolmentYear);
    const deptModules = ctx.ids.moduleByDepartment.get(prog.departmentId) ?? [];

    for (let y = 0; y < yearsHistory; y++) {
      const ayYear = enrolmentYear + y;
      const ayLabel = `${ayYear}/${(ayYear + 1).toString().slice(2)}`;
      const ayId = ctx.ids.academicYearIdByLabel.get(ayLabel);
      if (!ayId) continue;
      const enrolmentId = `en-${studentId.slice(4)}-y${y + 1}`;
      const yearStatus = (isAlumni && y === yearsHistory - 1) ? 'COMPLETED'
                       : (y === yearsHistory - 1 ? 'ACTIVE' : 'COMPLETED');
      enRows.push({
        id: enrolmentId, ...audit,
        studentId, programmeId: prog.id, academicYearId: ayId, status: yearStatus,
        enrolmentDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        expectedEndDate: ayEndDate(ayLabel) + 'T00:00:00Z',
        actualEndDate: (yearStatus === 'COMPLETED') ? ayEndDate(ayLabel) + 'T00:00:00Z' : null,
        modeOfStudy: mode, studyIntensity: mode === 'PART_TIME' ? 'PT' : 'FT',
        sponsorId: null, fundingSource: fundingSourceForFeeStatus(feeStatus, rng),
        hesaEngagementId: `HE${seq}${y}`.padEnd(11, '0'),
        yearOfProgramme: y + 1,
        fundingCompletion: null, typeOfYear: 'STANDARD', instancePeriod: '1',
        tenantId: ctx.tenantId,
      });
      ctx.ids.enrolmentIds.push({ id: enrolmentId, studentId, programmeId: prog.id, ayId, status: yearStatus });

      // StudentInstance + InstancePeriod + EnrolmentOccurrence (HESA shape)
      const instanceId = `si-${enrolmentId.slice(3)}`;
      siRows.push({
        id: instanceId, ...audit,
        studyAimId, enrolmentId, instanceNumber: y + 1,
        status: yearStatus,
        hesaEngagementId: `HE${seq}${y}`.padEnd(11, '0'),
        startDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        expectedEndDate: ayEndDate(ayLabel) + 'T00:00:00Z',
        actualEndDate: yearStatus === 'COMPLETED' ? ayEndDate(ayLabel) + 'T00:00:00Z' : null,
        modeOfStudy: mode, studyIntensity: mode === 'PART_TIME' ? 'PT' : 'FT',
        fundingSource: fundingSourceForFeeStatus(feeStatus, rng), sponsorId: null,
      });
      const ipId = `ip-${instanceId.slice(3)}`;
      ipRows.push({
        id: ipId, ...audit,
        studentInstanceId: instanceId,
        programmeOccurrenceId: programmeOccByKey.get(`${prog.id}|${ayLabel}`),
        periodNumber: 1, hesaTypeOfYear: 'STANDARD',
        hesaFundComp: 'COMPLETED', hesaModeStat: mode === 'PART_TIME' ? 'PT' : 'FT',
        startDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        endDate: ayEndDate(ayLabel) + 'T00:00:00Z',
        studyIntensity: mode === 'PART_TIME' ? 'PT' : 'FT',
        creditsAttempted: prog.level === 'PGR' ? 0 : 120,
        creditsAchieved: prog.level === 'PGR' ? 0 : (yearStatus === 'COMPLETED' ? 120 : 60),
      });
      eoRows.push({
        id: `eo-${enrolmentId.slice(3)}`, ...audit,
        instancePeriodId: ipId, registrationDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        confirmationDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        modeOfStudy: mode, studyIntensity: mode === 'PART_TIME' ? 'PT' : 'FT',
        feeStatus, isConfirmed: true,
      });

      // ModuleRegistrations — 5-6 per enrolment
      if (deptModules.length) {
        const numMRs = prog.level === 'PGR' ? 0 : MODULES_PER_ENROLMENT;
        const sample = rng.pickN(deptModules, Math.min(numMRs, deptModules.length));
        sample.forEach((modId, idx) => {
          mrRows.push({
            id: `mr-${enrolmentId.slice(3)}-${idx + 1}`, ...audit,
            enrolmentId, moduleId: modId, academicYearId: ayId,
            registrationDate: ayStartDate(ayLabel) + 'T00:00:00Z',
            deregistrationDate: null,
            grade: yearStatus === 'COMPLETED' ? Math.max(0, Math.min(100, Math.round(rng.gauss(58, 14)))) : null,
            classificationBand: null,
          });
        });
      }

      // PersonalTutorAllocation (one per AY)
      const tutorPool = ctx.ids.staffByDepartment.get(prog.departmentId) ?? [];
      if (tutorPool.length) {
        const tutorRecordId = rng.pick(tutorPool);
        // Need staffId (not recordId) for the FK
        const tutorStaff = ctx.ids.staffIds.find(s => s.recordId === tutorRecordId);
        if (tutorStaff) {
          ptaRows.push({
            id: `pta-${enrolmentId.slice(3)}`, ...audit,
            studentId, tutorId: tutorStaff.id,
            allocationDate: ayStartDate(ayLabel) + 'T00:00:00Z',
            endDate: ayEndDate(ayLabel) + 'T00:00:00Z',
          });
          taRows.push({
            id: `ta-${enrolmentId.slice(3)}`,
            createdAt: now, updatedAt: now, deletedAt: null,
            tutorId: tutorStaff.id, studentId, academicYear: ayLabel,
            assignedDate: ayStartDate(ayLabel) + 'T00:00:00Z',
            endDate: ayEndDate(ayLabel) + 'T00:00:00Z',
            status: 'ACTIVE', notes: null,
          });
          // Tutoring meetings (2-3 per AY)
          const numMeetings = rng.int(2, 4);
          for (let m = 0; m < numMeetings; m++) {
            const meetingDate = new Date(ayStartDate(ayLabel) + 'T10:00:00Z');
            meetingDate.setUTCMonth(meetingDate.getUTCMonth() + m * 3);
            if (meetingDate < new Date('2026-05-17')) {
              tmRows.push({
                id: `tm-${enrolmentId.slice(3)}-${m + 1}`, ...audit,
                studentId, tutorId: tutorStaff.id,
                meetingDate: meetingDate.toISOString(),
                notes: rng.chance(0.6) ? 'Progress on track; reviewed module engagement.' : null,
                actionItems: null,
              });
            }
          }
        }
      }

      // StudentStatusHistory entries
      sahRows.push({
        id: `ssh-${enrolmentId.slice(3)}-enr`,
        createdAt: now, studentId, enrolmentId, previousStatus: 'OFFER_HOLDER',
        newStatus: 'ENROLLED', effectiveDate: ayStartDate(ayLabel) + 'T00:00:00Z',
        reasonCode: null, reasonDetail: null,
        changedBy: ctx.seedActor, changeSource: 'ENROLMENT_WORKFLOW',
        hesaReportingFlag: true, notes: null,
      });
    }

    // EnrolmentWorkflow + Stages for current enrolment
    if (yearsHistory > 0 && !isAlumni) {
      const wfId = `ew-${studentId.slice(4)}`;
      ewRows.push({
        id: wfId, createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
        studentId, programmeId: prog.id, academicYear: CURRENT_ACTIVE_YEAR,
        currentStage: 'COMPLETE', status: 'COMPLETED',
        startedAt: now, completedAt: now, stageData: null,
      });
      ['CONSENT', 'PERSONAL_DETAILS', 'MODULE_CHOICES', 'FEE_PAYMENT', 'COMPLETE'].forEach((stage, idx) => {
        ewsRows.push({
          id: `ews-${wfId.slice(3)}-${stage.toLowerCase()}`,
          createdAt: now, updatedAt: now, workflowId: wfId,
          stageName: stage, status: 'COMPLETED',
          startedAt: now, completedAt: now, completedBy: studentId, notes: null,
        });
      });
    }

    // For alumni: CompletionEvent
    if (isAlumni && yearsHistory > 0) {
      const lastInstance = siRows[siRows.length - 1];
      cpRows.push({
        id: `cp-${lastInstance.id.slice(3)}`, ...audit,
        studentInstanceId: lastInstance.id,
        completionDate: ayEndDate(`${enrolmentYear + yearsHistory - 1}/${(enrolmentYear + yearsHistory).toString().slice(2)}`) + 'T00:00:00Z',
        classification: rng.weighted([['FIRST', 20], ['UPPER_SECOND', 50], ['LOWER_SECOND', 22], ['THIRD', 6], ['PASS', 2]]),
        totalCredits: prog.level === 'PGR' ? 0 : prog.credits,
        gpa: rng.float(2.0, 4.0).toFixed(2),
        awardTitle: prog.name, hesaRsnEnd: '01',
        boardApprovedDate: ayEndDate(`${enrolmentYear + yearsHistory - 1}/${(enrolmentYear + yearsHistory).toString().slice(2)}`) + 'T00:00:00Z',
        certificateIssued: true,
      });
    }

    // Withdrawal (15% of active students get a withdrawal in their last enrolment)
    if (!isAlumni && yearsHistory > 0 && rng.chance(0.07)) {
      const lastInstance = siRows[siRows.length - 1];
      wdRows.push({
        id: `wd-${lastInstance.id.slice(3)}`, ...audit,
        studentInstanceId: lastInstance.id,
        withdrawalDate: ayStartDate(CURRENT_ACTIVE_YEAR) + 'T00:00:00Z',
        lastAttendanceDate: ayStartDate(CURRENT_ACTIVE_YEAR) + 'T00:00:00Z',
        hesaRsnEnd: rng.pick(['06', '07', '08', '09']),
        reasonDetail: 'Personal reasons',
        isVoluntary: true, refundEligible: rng.chance(0.5),
        approvedBy: ctx.seedActor, approvedDate: now,
      });
    }

    // Interruption (~3%)
    if (yearsHistory > 1 && rng.chance(0.03) && siRows.length) {
      const instId = siRows[siRows.length - 1].id;
      intRows.push({
        id: `int-${instId.slice(3)}`, ...audit,
        studentInstanceId: instId,
        hesaNotActiveCode: 'INTERRUPTED', reasonCode: 'PERSONAL',
        reasonDetail: 'Personal reasons — temporary suspension',
        interruptionDate: ayStartDate(`${enrolmentYear + 1}/${(enrolmentYear + 2).toString().slice(2)}`) + 'T00:00:00Z',
        expectedReturnDate: ayStartDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
        actualReturnDate: ayStartDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
        approvedBy: ctx.seedActor, approvedDate: now,
      });
    }

    // Transfer (~2%)
    if (yearsHistory > 1 && rng.chance(0.02) && siRows.length) {
      const instId = siRows[siRows.length - 1].id;
      const fromProg = ctx.ids.programmeIds.filter(p => p.level === level)[0];
      trRows.push({
        id: `tr-${instId.slice(3)}`, ...audit,
        studentInstanceId: instId, transferType: 'INTERNAL',
        fromProgrammeId: fromProg?.id ?? null, toProgrammeId: prog.id,
        fromInstitution: null, toInstitution: null,
        transferDate: ayStartDate(`${enrolmentYear + 1}/${(enrolmentYear + 2).toString().slice(2)}`) + 'T00:00:00Z',
        creditsTransferred: 60, reasonCode: 'PROGRAMME_CHANGE',
        approvedBy: ctx.seedActor, approvedDate: now,
      });
    }

    // ModeOfStudyHistory (~8% switch)
    if (yearsHistory > 1 && rng.chance(0.08) && siRows.length) {
      const instId = siRows[siRows.length - 1].id;
      moshRows.push({
        id: `mosh-${instId.slice(3)}`, ...audit,
        studentInstanceId: instId, previousMode: 'FT', newMode: 'PT',
        effectiveDate: ayStartDate(`${enrolmentYear + 1}/${(enrolmentYear + 2).toString().slice(2)}`) + 'T00:00:00Z',
        reasonCode: 'PERSONAL', reasonDetail: 'Personal circumstances',
        approvedBy: ctx.seedActor, approvedDate: now,
      });
    }

    // Apprenticeship registration (5% of UG)
    if (!isAlumni && level === 'UG' && rng.chance(APPRENTICE_FRACTION)) {
      const [stdCode, stdName, lvl] = rng.pick(APPRENTICESHIP_STANDARDS);
      const apId = `apr-${studentId.slice(4)}`;
      apRegRows.push({
        id: apId, createdAt: now, updatedAt: now, deletedAt: null,
        studentId, employerId: rng.pick(employerIds),
        standardCode: stdCode, standardName: stdName, level: lvl,
        startDate: ayStartDate(`${enrolmentYear}/${(enrolmentYear + 1).toString().slice(2)}`) + 'T00:00:00Z',
        expectedEndDate: ayEndDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
        actualEndDate: null, status: 'ACTIVE',
        fundingBand: rng.pick(['£21k', '£18k', '£15k', '£27k']),
        negotiatedPrice: rng.int(15000, 27000) + '',
        employerContribution: rng.int(0, 2700) + '',
        otjTargetHours: 365,
      });
      // OTJ records (~20 per apprentice)
      for (let o = 0; o < 20; o++) {
        const weekStart = new Date(ayStartDate(`${enrolmentYear}/${(enrolmentYear + 1).toString().slice(2)}`));
        weekStart.setUTCDate(weekStart.getUTCDate() + o * 14);
        apOtjRows.push({
          id: `otj-${apId.slice(3)}-${o + 1}`, createdAt: now, updatedAt: now,
          registrationId: apId, activityDate: weekStart.toISOString(),
          weekStarting: weekStart.toISOString(),
          hours: rng.int(6, 9), plannedHours: 8, actualHours: rng.int(6, 9),
          activityType: rng.pick(['WORK_BASED_LEARNING', 'TRAINING', 'MENTORING', 'PROJECT_WORK']),
          activities: 'Structured learning activity',
          description: null, evidence: null,
          verifiedBy: 'employer.contact@employer.example.com', verifiedAt: now,
          verifiedByEmployer: true, verifiedByProvider: true,
        });
      }
      apGwRows.push({
        id: `agw-${apId.slice(3)}`, createdAt: now, updatedAt: now,
        registrationId: apId,
        gatewayDate: ayEndDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
        readinessDecision: 'READY', assessorName: 'EPA Assessor',
        employerConfirmed: true, providerConfirmed: true,
        mathsAchieved: true, englishAchieved: true,
        portfolioComplete: true, ready: true, notes: null,
      });
      // EPA for some
      if (rng.chance(0.3)) {
        apEpaRows.push({
          id: `epa-${apId.slice(3)}`, createdAt: now, updatedAt: now,
          registrationId: apId, epaOrganisation: 'IfATE-approved EPA',
          assessmentDate: ayEndDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
          grade: rng.weighted([['PASS', 55], ['MERIT', 30], ['DISTINCTION', 15]]),
          overallGrade: 'PASS', componentResults: null,
          achievementDate: ayEndDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
          certificateNumber: `CERT${rng.int(100000, 999999)}`,
          certificateDate: ayEndDate(`${enrolmentYear + 2}/${(enrolmentYear + 3).toString().slice(2)}`) + 'T00:00:00Z',
        });
      }
    }

    // CoCurricularRecord (~30%)
    if (rng.chance(COCURRICULAR_FRACTION)) {
      ccRows.push({
        id: `cc-${studentId.slice(4)}`, ...audit,
        studentId, activityType: rng.pick(['VOLUNTEERING', 'SPORTS', 'LEADERSHIP', 'ENTERPRISE']),
        title: rng.pick(['Volunteering coordinator', 'Society treasurer', 'Sports captain', 'Mentor']),
        description: null,
        organisation: rng.chance(0.6) ? 'Future Horizons Students\' Union' : null,
        startDate: ayStartDate(CURRENT_ACTIVE_YEAR) + 'T00:00:00Z',
        endDate: null, hoursCompleted: rng.int(20, 100),
        skillsDeveloped: 'Leadership, teamwork, communication',
        verified: true, verifiedBy: 'student.experience@fhe.ac.uk', verifiedDate: now,
        heaReference: null,
      });
    }

    // StudentOrgMembership (~40%)
    if (rng.chance(ORG_MEMBERSHIP_FRACTION)) {
      somRows.push({
        id: `som-${studentId.slice(4)}`, ...audit,
        organisationId: `sorg-football-club`,    // placeholder; orgs IDs not easily lookupable here
        studentId, role: 'MEMBER',
        joinedDate: ayStartDate(CURRENT_ACTIVE_YEAR) + 'T00:00:00Z',
        leftDate: null, academicYear: CURRENT_ACTIVE_YEAR,
        isHESAReportable: true,
      });
    }
  }

  let seq = 0;
  const activeCount = ctx.scaled(ACTIVE_STUDENTS);
  const alumniCount = ctx.scaled(ALUMNI);
  const total = activeCount + alumniCount;
  for (let i = 0; i < total; i++) {
    seq += 1;
    emitStudent(seq, { isAlumni: i >= activeCount });
    if (seq % 5000 === 0) ctx.log(domain, `... ${seq.toLocaleString()} students generated`);
  }

  // 3. StaffModuleAssignment — assign academic staff to modules per AY
  for (const mod of ctx.ids.moduleIds) {
    const deptStaff = ctx.ids.staffByDepartment.get(mod.deptId) ?? [];
    if (!deptStaff.length) continue;
    for (const ay of ACADEMIC_YEARS.slice(0, 5)) {
      const staffRecordId = deptStaff[Math.floor(rng.next() * deptStaff.length)];
      const staffEntry = ctx.ids.staffIds.find(s => s.recordId === staffRecordId);
      if (!staffEntry) continue;
      smaRows.push({
        id: `sma-${mod.code.toLowerCase()}-${ay.replace('/', '')}`,
        createdAt: now, updatedAt: now, deletedAt: null,
        staffId: staffEntry.id, moduleId: mod.id, academicYear: ay,
        role: 'MODULE_LEADER', hoursPerWeek: 3,
      });
    }
  }

  ctx.append('Student', stRows);
  ctx.append('Enrolment', enRows);
  ctx.append('ModuleRegistration', mrRows);
  ctx.append('StudentStatusHistory', sahRows);
  ctx.append('StudyAim', saRows);
  ctx.append('StudentInstance', siRows);
  ctx.append('InstancePeriod', ipRows);
  ctx.append('EnrolmentOccurrence', eoRows);
  ctx.append('ModeOfStudyHistory', moshRows);
  ctx.append('InterruptionEvent', intRows);
  ctx.append('TransferEvent', trRows);
  ctx.append('CompletionEvent', cpRows);
  ctx.append('WithdrawalEvent', wdRows);
  ctx.append('PersonalTutorAllocation', ptaRows);
  ctx.append('TutorAssignment', taRows);
  ctx.append('TutoringMeeting', tmRows);
  ctx.append('StaffModuleAssignment', smaRows);
  ctx.append('ApprenticeshipRegistration', apRegRows);
  ctx.append('ApprenticeshipOtjRecord', apOtjRows);
  ctx.append('ApprenticeshipGateway', apGwRows);
  ctx.append('ApprenticeshipEpa', apEpaRows);
  ctx.append('EnrolmentWorkflow', ewRows);
  ctx.append('EnrolmentWorkflowStage', ewsRows);
  ctx.append('CoCurricularRecord', ccRows);
  ctx.append('StudentOrgMembership', somRows);

  ctx.log(domain,
    `${stRows.length.toLocaleString()} students (${ACTIVE_STUDENTS.toLocaleString()} active + ${ALUMNI.toLocaleString()} alumni), ` +
    `${enRows.length.toLocaleString()} enrolments, ${mrRows.length.toLocaleString()} module regs, ` +
    `${apRegRows.length.toLocaleString()} apprentices, ${tmRows.length.toLocaleString()} tutoring meetings`);
}
