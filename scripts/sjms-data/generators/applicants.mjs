/**
 * applicants generator (D5)
 *
 * Admissions cycle 2026/27:
 *   Applicant                10,000 (with Person family — most are UCAS-routed)
 *   Application              10,000 (one primary application per applicant)
 *   ApplicantQualification   ~25,000 (3 A-levels average + 1 GCSE block)
 *   PersonalStatement        ~9,500 (95% submit)
 *   Reference                ~14,000 (1.4 per applicant average)
 *   UcasApplication          ~8,500 (85% UCAS-routed; rest direct/clearing)
 *   UcasImportLog            ~120 (daily batches over the cycle)
 *   Offer                    ~5,500 (55% offer rate)
 *   InterviewSchedule        ~700 (interview-required programmes — Medicine/Law/Arts)
 *   ClearingApplication      ~1,200 (12% via clearing)
 *   EntryRequirement         ~2,400 (3-4 per programme spec)
 *   TariffCalculation        ~150 (UCAS tariff lookup table)
 *
 * Marketing tail:
 *   Prospect                 ~30,000 (pre-applicant marketing list)
 *   ProspectInteraction      ~75,000 (~2.5 touches per prospect)
 *   RecruitmentCampaign      50
 *   RecruitmentEvent         ~200
 *
 * Of the 10k applicants, ~5,500 get offers, ~3,000 accept firmly, ~2,500
 * will enrol (handed to D6 students generator via ctx.ids.applicantIds).
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { FIRST_NAMES, LAST_NAMES, GENDERS_WEIGHTED, ETHNICITY_WEIGHTED, DISABILITY_WEIGHTED, DOMICILES_WEIGHTED, FEE_STATUS_WEIGHTED, POLAR_QUINTILES_WEIGHTED, POSTCODE_AREAS, UG_AGE_AT_ENROLMENT_MEAN, UG_AGE_AT_ENROLMENT_STDDEV, PGT_AGE_AT_ENROLMENT_MEAN, PGT_AGE_AT_ENROLMENT_STDDEV } from '../lib/uk-demographics.mjs';
import { ucasCycleDates, CURRENT_ADMISSIONS_CYCLE } from '../lib/academic-calendar.mjs';
import { createPerson } from '../lib/person-factory.mjs';

export const domain = 'applicants';

const APPLICATION_STATUSES = [
  ['SUBMITTED', 5], ['UNDER_REVIEW', 10], ['OFFER_MADE', 30],
  ['CONDITIONAL_OFFER', 25], ['ACCEPTED_FIRM', 20],
  ['ACCEPTED_INSURANCE', 5], ['REJECTED', 3], ['WITHDRAWN', 2],
];

const TARIFF_TABLE = [
  // A-levels (3-year)
  ['A_LEVEL', 'A*', 56], ['A_LEVEL', 'A', 48], ['A_LEVEL', 'B', 40],
  ['A_LEVEL', 'C', 32], ['A_LEVEL', 'D', 24], ['A_LEVEL', 'E', 16],
  // AS levels (1-year)
  ['AS_LEVEL', 'A', 20], ['AS_LEVEL', 'B', 16], ['AS_LEVEL', 'C', 12],
  ['AS_LEVEL', 'D', 10], ['AS_LEVEL', 'E', 6],
  // BTEC Extended Diploma (D*D*D* highest, 168 points)
  ['BTEC_EXT_DIPLOMA', 'D*D*D*', 168], ['BTEC_EXT_DIPLOMA', 'D*D*D', 160],
  ['BTEC_EXT_DIPLOMA', 'D*DD', 152], ['BTEC_EXT_DIPLOMA', 'DDD', 144],
  ['BTEC_EXT_DIPLOMA', 'DDM', 128], ['BTEC_EXT_DIPLOMA', 'DMM', 112],
  // International Baccalaureate
  ['IB_DIPLOMA', '45', 64], ['IB_DIPLOMA', '38', 56], ['IB_DIPLOMA', '34', 48],
  // T-levels (new — Sep 2020+)
  ['T_LEVEL', 'DISTINCTION_STAR', 168], ['T_LEVEL', 'DISTINCTION', 144],
  ['T_LEVEL', 'MERIT', 120], ['T_LEVEL', 'PASS', 72],
  // Access to HE Diploma
  ['ACCESS_DIPLOMA', '60_DISTINCTION', 144],
  ['ACCESS_DIPLOMA', '45_D_15_M', 132],
  // Scottish Highers
  ['SCOT_HIGHER', 'A', 33], ['SCOT_HIGHER', 'B', 27], ['SCOT_HIGHER', 'C', 21],
  // GCSEs (capped — not in tariff)
  ['GCSE', '9', 0], ['GCSE', '8', 0], ['GCSE', '7', 0], ['GCSE', '6', 0],
];

const SUBJECTS = ['Mathematics', 'English Literature', 'Biology', 'Chemistry', 'Physics',
  'History', 'Geography', 'Economics', 'Psychology', 'Sociology', 'Business Studies',
  'Computing', 'Spanish', 'French', 'German', 'Art', 'Music', 'Drama', 'PE',
  'Religious Studies', 'Politics', 'Law', 'Media Studies', 'Photography'];

const SCHOOLS = ['Westminster School', 'King Edward VI School', 'Manchester Grammar School',
  'St Paul\'s School', 'Eton College', 'Tonbridge School', 'Oundle School', 'Sevenoaks School',
  'The King\'s School', 'St Mary\'s School', 'Reigate College', 'Hills Road Sixth Form College',
  'Brighton Hove and Sussex Sixth Form College', 'Newcastle Sixth Form College',
  'Manchester College', 'Birmingham Metropolitan College', 'Bromsgrove School',
  'Westminster City Sixth Form', 'St George\'s College', 'Cardinal Newman College'];

const CAMPAIGN_TYPES = ['OPEN_DAY', 'VIRTUAL_TOUR', 'UCAS_FAIR', 'SCHOOL_VISIT', 'SOCIAL_MEDIA',
  'EMAIL', 'WEBINAR', 'CAREERS_FAIR', 'PARENTS_EVENING', 'INTERNATIONAL_RECRUITMENT'];

const EVENT_TYPES = ['OPEN_DAY', 'APPLICANT_DAY', 'OFFER_HOLDER_DAY', 'CLEARING_OPEN_DAY',
  'TASTER_SESSION', 'WEBINAR', 'CAMPUS_TOUR'];

function pickName(rng) {
  return { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES) };
}

function genderToHesaSex(g) {
  return ({ MALE: '1', FEMALE: '2', OTHER: '3', PREFER_NOT_TO_SAY: '4' })[g] ?? '4';
}

function dobForAge(rng, mean, stddev, asOfYear = 2026) {
  const age = Math.max(17, Math.min(45, Math.round(rng.gauss(mean, stddev))));
  return new Date(Date.UTC(asOfYear - age, rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10);
}

function applicantAddress(rng, idx) {
  const num = (idx % 999) + 1;
  const street = rng.pick(['High Street', 'Park Lane', 'Church Road', 'Manor Way',
    'Queens Drive', 'Kings Road', 'Albert Street', 'Victoria Avenue', 'Garden Crescent', 'Mill Road']);
  const area = rng.pick(POSTCODE_AREAS);
  const city = rng.pick(['Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Sheffield',
    'Newcastle', 'Bristol', 'Cardiff', 'Edinburgh', 'Belfast', 'Norwich', 'Cambridge',
    'York', 'Oxford', 'Reading', 'Brighton', 'Plymouth', 'Hull', 'Stoke-on-Trent',
    'Derby', 'Leicester', 'Coventry', 'Nottingham', 'Wolverhampton', 'Bradford']);
  return {
    line1: `${num} ${street}`, line2: null, line3: null, city, county: null,
    postcode: `${area}${rng.int(1, 9)} ${rng.int(1, 9)}${rng.pick(['AA','AB','BB','CD','EF'])}`,
    country: 'United Kingdom', countryCode: 'GB',
  };
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('applicants');
  const cycleDates = ucasCycleDates(CURRENT_ADMISSIONS_CYCLE);

  // 1. Tariff table (~50 lookup rows)
  ctx.append('TariffCalculation', TARIFF_TABLE.map(([qt, grade, pts], i) => ({
    id: `tariff-${qt.toLowerCase()}-${grade.replace(/[^a-z0-9]/gi, '')}`.toLowerCase(),
    createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
    qualificationType: qt, grade, tariffPoints: pts,
  })));

  // 2. EntryRequirements — 3-4 per programme spec
  const entryReqRows = [];
  for (const p of ctx.ids.programmeIds) {
    if (p.level !== 'UG') continue;
    entryReqRows.push({
      id: `er-${p.id.slice(5)}-1`, ...audit,
      programmeSpecId: `pspec-${p.id.slice(5)}-v2`,
      qualificationType: 'A_LEVEL', subject: null,
      minimumGrade: rng.pick(['ABB', 'BBB', 'BBC', 'BCC', 'CCC']),
      tariffPoints: rng.int(96, 144),
      description: 'Three A-levels at the specified grades.',
    });
    entryReqRows.push({
      id: `er-${p.id.slice(5)}-2`, ...audit,
      programmeSpecId: `pspec-${p.id.slice(5)}-v2`,
      qualificationType: 'GCSE', subject: 'Mathematics',
      minimumGrade: '4', tariffPoints: 0,
      description: 'GCSE Mathematics grade 4 (C) or equivalent.',
    });
    entryReqRows.push({
      id: `er-${p.id.slice(5)}-3`, ...audit,
      programmeSpecId: `pspec-${p.id.slice(5)}-v2`,
      qualificationType: 'GCSE', subject: 'English Language',
      minimumGrade: '4', tariffPoints: 0,
      description: 'GCSE English Language grade 4 (C) or equivalent.',
    });
  }
  ctx.append('EntryRequirement', entryReqRows);

  // 3. Recruitment campaigns (50)
  const campaignRows = [];
  for (let c = 0; c < 50; c++) {
    const campaignType = rng.pick(CAMPAIGN_TYPES);
    const start = new Date(Date.UTC(2025, rng.int(8, 11), rng.int(1, 28)));
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + rng.int(1, 4));
    campaignRows.push({
      id: `rc-${(c + 1).toString().padStart(3, '0')}`, ...audit,
      name: `${campaignType.replace(/_/g, ' ')} ${(c + 1).toString()}`,
      campaignType,
      targetAudience: rng.pick(['UK_UG', 'INTL_UG', 'PGT', 'CLEARING', 'WP']),
      startDate: start.toISOString(), endDate: end.toISOString(),
      budget: rng.int(5_000, 100_000), actualSpend: rng.int(4_000, 95_000),
      targetProspects: rng.int(500, 5_000),
      actualProspects: rng.int(400, 4_500),
      conversions: rng.int(20, 200),
      status: rng.weighted([['COMPLETED', 70], ['ACTIVE', 20], ['PLANNED', 10]]),
    });
  }
  ctx.append('RecruitmentCampaign', campaignRows);

  // 4. Recruitment events (200)
  const eventRows = [];
  for (let e = 0; e < 200; e++) {
    const eventType = rng.pick(EVENT_TYPES);
    const eventDate = new Date(Date.UTC(2025, rng.int(8, 11), rng.int(1, 28)));
    const endDate = new Date(eventDate);
    endDate.setUTCHours(endDate.getUTCHours() + rng.int(2, 8));
    const registered = rng.int(20, 500);
    eventRows.push({
      id: `revt-${(e + 1).toString().padStart(3, '0')}`, ...audit,
      title: `${eventType.replace(/_/g, ' ')} - ${eventDate.toISOString().slice(0, 10)}`,
      eventType, eventDate: eventDate.toISOString(),
      endDate: endDate.toISOString(),
      location: rng.chance(0.7) ? 'Main Campus' : null,
      isVirtual: rng.chance(0.3),
      capacity: registered + rng.int(0, 100),
      registeredCount: registered,
      attendedCount: Math.round(registered * rng.float(0.5, 0.95)),
      description: `Recruitment ${eventType.toLowerCase().replace(/_/g, ' ')} for prospective students.`,
      targetProgrammes: null,
      registrationUrl: `https://recruit.fhe.ac.uk/events/${e + 1}`,
      feedbackScore: rng.float(3.5, 4.9).toFixed(1),
    });
  }
  ctx.append('RecruitmentEvent', eventRows);

  // 5. Prospects (30k pre-applicant marketing list)
  const prospectRows = [];
  const interactionRows = [];
  const prospectCount = ctx.scaled(30_000);
  for (let p = 0; p < prospectCount; p++) {
    const { first, last } = pickName(rng);
    const id = `prsp-${(p + 1).toString().padStart(6, '0')}`;
    const stage = rng.weighted([['NEW', 30], ['NURTURING', 35], ['QUALIFIED', 20],
      ['CONVERTED_TO_APPLICANT', 10], ['LOST', 5]]);
    prospectRows.push({
      id, ...audit,
      firstName: first, lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${p}@example.com`,
      phone: rng.chance(0.6) ? `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}` : null,
      dateOfBirth: dobForAge(rng, 18.5, 1.2) + 'T00:00:00Z',
      nationality: rng.weighted(DOMICILES_WEIGHTED),
      currentSchool: rng.chance(0.7) ? rng.pick(SCHOOLS) : null,
      expectedGrades: rng.pick(['AAA', 'AAB', 'ABB', 'BBB', 'BBC', 'BCC', 'CCC']),
      interestedProgrammes: JSON.stringify([rng.pick(ctx.ids.programmeIds).code]),
      source: rng.pick(['UCAS_FAIR', 'WEB_FORM', 'EMAIL_CAMPAIGN', 'OPEN_DAY', 'AGENT', 'REFERRAL']),
      status: stage,
      assignedTo: 'admissions@fhe.ac.uk', lastContactDate: now,
      nextFollowUp: null, tags: null,
      campaignSource: rng.pick(campaignRows).id,
      consentMarketing: true, consentData: true,
      notes: null,
    });
    // 2-3 interactions per prospect
    const numInter = rng.int(0, 5);
    for (let i = 0; i < numInter; i++) {
      interactionRows.push({
        id: `pi-${id.slice(5)}-${i + 1}`, ...audit,
        prospectId: id,
        interactionType: rng.pick(['EMAIL', 'PHONE', 'EVENT_ATTENDANCE', 'WEB_FORM', 'CHATBOT']),
        subject: rng.pick(['Open day attendance', 'Programme query', 'Application support', 'UCAS guidance']),
        notes: null,
        outcome: rng.pick(['POSITIVE', 'NEUTRAL', 'FOLLOW_UP_REQUIRED']),
        staffMember: 'admissions@fhe.ac.uk',
        duration: rng.int(2, 30),
      });
    }
  }
  ctx.append('Prospect', prospectRows);
  ctx.append('ProspectInteraction', interactionRows);

  // 6. Applicants + their applications
  const applicantRows = [];
  const applicationRows = [];
  const qualRows = [];
  const psRows = [];
  const refRows = [];
  const offerRows = [];
  const ucasRows = [];
  const interviewRows = [];
  const clearingRows = [];

  const APPLICANT_COUNT = ctx.scaled(10_000);
  for (let a = 0; a < APPLICANT_COUNT; a++) {
    const { first, last } = pickName(rng);
    const applicantNum = (a + 1).toString().padStart(6, '0');
    const isPGT = rng.chance(0.3);
    const dob = dobForAge(rng, isPGT ? PGT_AGE_AT_ENROLMENT_MEAN : UG_AGE_AT_ENROLMENT_MEAN,
                          isPGT ? PGT_AGE_AT_ENROLMENT_STDDEV : UG_AGE_AT_ENROLMENT_STDDEV);
    const gender = rng.weighted(GENDERS_WEIGHTED);
    const domicile = rng.weighted(DOMICILES_WEIGHTED);
    const nationality = domicile.startsWith('GB') ? 'GB' : domicile;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${a}@${rng.chance(0.5) ? 'gmail.com' : rng.pick(['outlook.com', 'yahoo.co.uk', 'hotmail.co.uk', 'student.example.com'])}`;
    const applicantId = `app-${applicantNum}`;
    const isUCAS = !isPGT && rng.chance(0.95);            // UG mostly UCAS, PGT mostly direct

    const { personId } = createPerson(ctx, {
      role: 'applicant', firstName: first, lastName: last, title: null,
      dateOfBirth: dob, gender, hesaSexId: genderToHesaSex(gender),
      email, phone: `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      nationalityCode: nationality, address: applicantAddress(rng, a),
      createdAt: now, effectiveFrom: cycleDates.applyOpens + 'T00:00:00Z',
    });

    applicantRows.push({
      id: applicantId, ...audit,
      firstName: first, middleNames: null, lastName: last,
      dateOfBirth: dob + 'T00:00:00Z',
      email, phone: `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      nationalityCode: nationality, countryOfOrigin: domicile, personId,
    });

    // Pick a programme that fits the applicant's level
    const candidatePrograms = ctx.ids.programmeIds.filter(p => p.level === (isPGT ? 'PGT' : 'UG'));
    const chosenProgramme = rng.pick(candidatePrograms);
    const appId = `appl-${applicantNum}`;
    const appStatus = rng.weighted(APPLICATION_STATUSES);
    const ucasCycle = ucasCycleDates(CURRENT_ADMISSIONS_CYCLE);
    const applicationDate = new Date(ucasCycle.applyOpens);
    applicationDate.setUTCDate(applicationDate.getUTCDate() + rng.int(0, 100));

    let acceptanceDate = null;
    let decisionDate = null;
    if (['OFFER_MADE', 'CONDITIONAL_OFFER', 'ACCEPTED_FIRM', 'ACCEPTED_INSURANCE', 'REJECTED'].includes(appStatus)) {
      decisionDate = new Date(applicationDate);
      decisionDate.setUTCDate(decisionDate.getUTCDate() + rng.int(14, 90));
    }
    if (['ACCEPTED_FIRM', 'ACCEPTED_INSURANCE'].includes(appStatus)) {
      acceptanceDate = new Date(decisionDate);
      acceptanceDate.setUTCDate(acceptanceDate.getUTCDate() + rng.int(1, 60));
    }
    applicationRows.push({
      id: appId, ...audit,
      applicantId, programmeId: chosenProgramme.id,
      applicationDate: applicationDate.toISOString(),
      status: appStatus, currentRound: rng.chance(0.85) ? 'MAIN' : 'CLEARING',
      decisionDate: decisionDate?.toISOString() ?? null,
      acceptanceDate: acceptanceDate?.toISOString() ?? null,
      enrolmentDate: null, rejectionReason: appStatus === 'REJECTED' ? 'Insufficient academic profile' : null,
      studentId: null,    // back-filled by D6 students generator
    });
    ctx.ids.applicantIds.push({
      id: applicantId, personId, programmeId: chosenProgramme.id, status: appStatus,
      applicationId: appId,
    });

    // Qualifications — 3 A-levels for UG; degree for PGT
    if (isPGT) {
      qualRows.push({
        id: `aq-${applicantId.slice(4)}-degree`, ...audit,
        applicantId, qualificationType: 'BACHELOR_DEGREE',
        subject: rng.pick(SUBJECTS), grade: rng.weighted([['FIRST', 25], ['UPPER_SECOND', 50], ['LOWER_SECOND', 22], ['THIRD', 3]]),
        achievementDate: new Date(Date.UTC(2024, 6, 15)).toISOString(),
      });
    } else {
      const numSubjects = rng.int(3, 4);
      const subjects = rng.pickN(SUBJECTS, numSubjects);
      for (const subj of subjects) {
        qualRows.push({
          id: `aq-${applicantId.slice(4)}-${subj.toLowerCase().replace(/\s/g, '')}`, ...audit,
          applicantId, qualificationType: 'A_LEVEL',
          subject: subj, grade: rng.weighted([['A*', 8], ['A', 18], ['B', 32], ['C', 24], ['D', 12], ['E', 6]]),
          achievementDate: new Date(Date.UTC(2025, 7, 15)).toISOString(),
        });
      }
    }
    // GCSE block summary
    qualRows.push({
      id: `aq-${applicantId.slice(4)}-gcsemath`, ...audit,
      applicantId, qualificationType: 'GCSE',
      subject: 'Mathematics', grade: rng.pick(['9','8','7','6','5','4']),
      achievementDate: new Date(Date.UTC(2023, 7, 15)).toISOString(),
    });
    qualRows.push({
      id: `aq-${applicantId.slice(4)}-gcseeng`, ...audit,
      applicantId, qualificationType: 'GCSE',
      subject: 'English Language', grade: rng.pick(['9','8','7','6','5','4']),
      achievementDate: new Date(Date.UTC(2023, 7, 15)).toISOString(),
    });

    // Personal statement (95% submit)
    if (rng.chance(0.95)) {
      psRows.push({
        id: `ps-${applicantId.slice(4)}`, ...audit,
        applicantId,
        content: `I have been passionate about ${chosenProgramme.name.toLowerCase()} since I was young. My academic record demonstrates my commitment to the subject, and my volunteering experience has reinforced my desire to pursue this discipline at university level. [synthetic content – 4000 chars in production]`,
        submittedDate: applicationDate.toISOString(),
      });
    }

    // References — 1-2 per applicant
    const numRefs = rng.int(1, 2);
    for (let r = 0; r < numRefs; r++) {
      refRows.push({
        id: `ref-${applicantId.slice(4)}-${r + 1}`, ...audit,
        applicantId,
        refereeeName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        refereeEmail: 'referee@school.example.com',
        refereePhone: null,
        refereeOrganism: rng.chance(0.7) ? rng.pick(SCHOOLS) : 'Employer',
        content: rng.chance(0.85) ? 'Strong academic and personal reference.' : null,
        submittedDate: rng.chance(0.85) ? applicationDate.toISOString() : null,
        requestDate: applicationDate.toISOString(),
      });
    }

    // UCAS application
    if (isUCAS) {
      ucasRows.push({
        id: `ucas-${applicantId.slice(4)}`, ...audit,
        applicationId: appId,
        ucasReference: `${100 + a.toString().slice(-9).padStart(9, '0').slice(0, 10)}`,
        submissionDate: applicationDate.toISOString(),
        decisionDate: decisionDate?.toISOString() ?? null,
      });
    }

    // Offer (~55%)
    if (['OFFER_MADE', 'CONDITIONAL_OFFER', 'ACCEPTED_FIRM', 'ACCEPTED_INSURANCE'].includes(appStatus)) {
      offerRows.push({
        id: `offer-${appId.slice(5)}`, ...audit,
        applicationId: appId,
        offerType: appStatus === 'OFFER_MADE' || appStatus === 'ACCEPTED_FIRM' ? 'CONDITIONAL' : 'CONDITIONAL',
        conditions: 'Achieve predicted grades; pass GCSE Maths/English.',
        issueDate: decisionDate.toISOString(),
        responseDeadline: new Date(cycleDates.equalConsideration + 'T00:00:00Z').toISOString(),
        acceptanceDate: acceptanceDate?.toISOString() ?? null,
        declineDate: null,
      });
    }

    // Interview (5% — Medicine, Law, Arts programmes)
    if (rng.chance(0.05)) {
      interviewRows.push({
        id: `intv-${appId.slice(5)}`, ...audit,
        applicationId: appId, applicantId,
        interviewDate: new Date(Date.UTC(2026, 1, rng.int(1, 28))).toISOString(),
        interviewType: rng.pick(['IN_PERSON', 'VIDEO', 'TELEPHONE']),
        interviewerName: 'Programme Admissions Tutor',
        location: rng.chance(0.7) ? 'Main Campus' : 'Virtual',
        feedbackNotes: rng.chance(0.7) ? 'Engaged and articulate candidate.' : null,
        outcome: rng.weighted([['PASS', 60], ['BORDERLINE', 25], ['FAIL', 15]]),
      });
    }

    // Clearing (12% of UG)
    if (!isPGT && rng.chance(0.12)) {
      clearingRows.push({
        id: `clr-${appId.slice(5)}`, ...audit,
        applicationId: appId,
        clearingChoice: chosenProgramme.code,
        applyDate: new Date(cycleDates.clearingOpens + 'T00:00:00Z').toISOString(),
        acceptanceDate: rng.chance(0.7) ? new Date(cycleDates.clearingOpens + 'T00:00:00Z').toISOString() : null,
      });
    }
  }

  ctx.append('Applicant', applicantRows);
  ctx.append('Application', applicationRows);
  ctx.append('ApplicantQualification', qualRows);
  ctx.append('PersonalStatement', psRows);
  ctx.append('Reference', refRows);
  ctx.append('Offer', offerRows);
  ctx.append('UcasApplication', ucasRows);
  ctx.append('InterviewSchedule', interviewRows);
  ctx.append('ClearingApplication', clearingRows);

  // UCAS import logs — daily batches over the cycle
  const importLogRows = [];
  for (let d = 0; d < 120; d++) {
    const logDate = new Date(cycleDates.applyOpens + 'T00:00:00Z');
    logDate.setUTCDate(logDate.getUTCDate() + d * 2);
    importLogRows.push({
      id: `uil-${(d + 1).toString().padStart(3, '0')}`,
      createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
      ucasApplicationId: ucasRows[d % ucasRows.length]?.id ?? `ucas-000001`,
      importDate: logDate.toISOString(),
      recordCount: rng.int(50, 500),
      errorCount: rng.int(0, 5),
      errorMessage: null,
    });
  }
  ctx.append('UcasImportLog', importLogRows);

  ctx.log(domain,
    `${applicantRows.length} applicants, ${applicationRows.length} applications, ${offerRows.length} offers, ${qualRows.length} qualifications, ${prospectRows.length} prospects, ${interactionRows.length} interactions`);
}
