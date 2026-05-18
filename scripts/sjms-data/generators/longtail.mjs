/**
 * longtail generator (D10) — 92 models across welfare, placements, PGR,
 * comms, research (REF/KEF), regulatory (HESA/OfS/UKVI), GDPR, misc,
 * timetabling, accommodation-booking, AI, VLE.
 *
 * Per-sub-domain volumes are pragmatic — enough rows to populate the shape
 * but small enough that the full generator stays under 60s. Production-scale
 * HESA snapshots would be ~10× larger; that's a Phase 0+ uplift.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ACADEMIC_YEARS, ayStartDate, ayEndDate, CURRENT_ACTIVE_YEAR } from '../lib/academic-calendar.mjs';

export const domain = 'longtail';

const BATCH = 5000;
const flush = (ctx, model, batch) => { if (batch.length) { ctx.append(model, batch); batch.length = 0; } };

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('longtail');

  // Pre-index for fast lookups
  const studentById = new Map();
  for (const s of ctx.ids.studentIds) studentById.set(s.id, s);

  // ─── welfare ──────────────────────────────────────────────────────────
  const supportTickets = [];
  const supportComments = [];
  const sampleStudents = ctx.ids.studentIds.slice(0, 5000);
  for (let i = 0; i < sampleStudents.length; i++) {
    const stu = sampleStudents[i];
    const ticketId = `tk-${(i + 1).toString().padStart(5, '0')}`;
    supportTickets.push({
      id: ticketId, ...audit, studentId: stu.id,
      ticketNumber: `T-${ticketId.slice(3)}`,
      subject: rng.pick(['Library access', 'Module change request', 'IT account issue',
        'Disability adjustments', 'Fee enquiry', 'Visa support']),
      description: 'Initial enquiry from student.',
      status: rng.weighted([['OPEN', 15], ['IN_PROGRESS', 30], ['RESOLVED', 50], ['CLOSED', 5]]),
      priority: rng.weighted([['LOW', 40], ['MEDIUM', 50], ['HIGH', 10]]),
      category: 'STUDENT_SUPPORT', assignedTo: 'support@fhe.ac.uk',
      resolvedDate: rng.chance(0.55) ? now : null,
    });
    for (let c = 0; c < 2; c++) {
      supportComments.push({
        id: `tc-${ticketId.slice(3)}-${c + 1}`, ...audit,
        ticketId, comment: c === 0 ? 'Acknowledged; routing to specialist team.' : 'Response provided to student.',
      });
    }
  }
  ctx.append('SupportTicket', supportTickets);
  ctx.append('SupportTicketComment', supportComments);

  const misconductCases = [];
  const misconductSanctions = [];
  for (let i = 0; i < 800; i++) {
    const stu = ctx.ids.studentIds[i * 100 % ctx.ids.studentIds.length];
    const caseId = `mc-${(i + 1).toString().padStart(4, '0')}`;
    misconductCases.push({
      id: caseId, ...audit, studentId: stu.id,
      caseReference: `MC-2025-${(i + 1).toString().padStart(4, '0')}`,
      allegation: rng.pick(['Plagiarism', 'Collusion', 'Examination misconduct', 'Falsification']),
      reportedDate: now, investigationStarted: now, investigationCompleted: now,
      outcome: rng.weighted([['NO_CASE', 20], ['MINOR_PENALTY', 40], ['MAJOR_PENALTY', 30], ['EXPULSION', 10]]),
    });
    if (rng.chance(0.7)) {
      misconductSanctions.push({
        id: `ms-${caseId.slice(3)}`, ...audit,
        caseId, sanctionType: rng.pick(['MARK_REDUCTION', 'COURSE_FAILURE', 'SUSPENSION', 'EXPULSION']),
        duration: rng.int(0, 365), fromDate: now,
        toDate: rng.chance(0.5) ? now : null,
      });
    }
  }
  ctx.append('MisconductCase', misconductCases);
  ctx.append('MisconductSanction', misconductSanctions);

  const disabledStudents = ctx.ids.studentIds.filter(s => s.disability && s.disability !== 'NONE');
  ctx.append('DisabilityAdjustment', disabledStudents.slice(0, 5000).map((stu, i) => ({
    id: `da-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id,
    adjustmentType: rng.pick(['EXTRA_TIME', 'SEPARATE_ROOM', 'ASSISTIVE_TECH', 'EXTENDED_DEADLINES', 'NOTE_TAKER']),
    description: 'Per Disability Services needs assessment',
    approvalDate: now, expiryDate: null, evidenceProvided: true,
  })));

  ctx.append('WellbeingRecord', ctx.ids.studentIds.slice(0, 8000).map((stu, i) => ({
    id: `wr-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, enrolmentId: null,
    recordDate: now,
    wellbeingScore: rng.int(40, 95),
    concerns: rng.chance(0.3) ? 'Anxiety / low mood' : null,
    supportProvided: rng.chance(0.6) ? 'Counselling referral' : null,
    referralMade: rng.chance(0.2),
  })));

  ctx.append('WelfareReferral', ctx.ids.studentIds.slice(0, 2500).map((stu) => ({
    id: `wref-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, referralDate: now,
    referralType: rng.pick(['WELLBEING', 'COUNSELLING', 'FINANCIAL_HARDSHIP', 'SAFEGUARDING']),
    referredTo: 'wellbeing@fhe.ac.uk',
    referralReason: 'Student support need identified',
    status: rng.weighted([['OPEN', 30], ['IN_PROGRESS', 30], ['CLOSED', 40]]),
  })));

  ctx.append('CounsellingRecord', ctx.ids.studentIds.slice(0, 3000).map((stu) => ({
    id: `cr-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, sessionDate: now,
    counsellorName: 'Counsellor', sessionType: rng.pick(['INITIAL', 'FOLLOW_UP', 'CRISIS']),
    issues: 'General wellbeing support', followUpRequired: rng.chance(0.5),
  })));

  // ─── placements ─────────────────────────────────────────────────────────
  const providers = Array.from({ length: 200 }, (_, i) => ({
    id: `prov-${(i + 1).toString().padStart(3, '0')}`,
    ...audit,
    name: `${rng.pick(['Acme', 'Global', 'United', 'Premier', 'Northern', 'Atlantic'])} ${rng.pick(['Healthcare', 'Engineering', 'Consulting', 'Legal', 'Technology', 'Media'])} ${(i + 1)}`,
    type: rng.pick(['CORPORATE', 'NHS', 'GOVERNMENT', 'CHARITY', 'SME']),
    address: `${rng.int(1, 200)} Business Park`,
    city: rng.pick(['London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Edinburgh']),
    postcode: 'AB1 2CD', country: 'United Kingdom',
    contactPerson: 'Placement Coordinator',
    email: `placements@provider${i + 1}.example.com`,
    phone: `020 ${rng.int(7000, 8999)} ${rng.int(1000, 9999)}`,
  }));
  ctx.append('PlacementProvider', providers);

  const placements = [];
  const placementVisits = [];
  for (let i = 0; i < 5000; i++) {
    const stu = ctx.ids.studentIds[i * 10 % ctx.ids.studentIds.length];
    const placementId = `pl-${(i + 1).toString().padStart(5, '0')}`;
    placements.push({
      id: placementId, ...audit,
      studentId: stu.id, providerId: rng.pick(providers).id,
      startDate: '2025-09-01T00:00:00Z', endDate: '2026-08-31T00:00:00Z',
      jobTitle: rng.pick(['Intern', 'Placement Student', 'Industrial Trainee', 'Research Assistant']),
      description: 'Year-in-industry placement.',
      hoursPerWeek: 37.5, isCompulsory: rng.chance(0.6),
    });
    if (rng.chance(0.4)) {
      placementVisits.push({
        id: `pv-${placementId.slice(3)}`, ...audit,
        placementId, visitDate: '2026-02-15T00:00:00Z',
        visitedBy: 'placement.tutor@fhe.ac.uk',
        feedback: 'Student progressing well; on track for module requirements.',
      });
    }
  }
  ctx.append('StudentPlacement', placements);
  ctx.append('PlacementVisit', placementVisits);

  ctx.append('CareerEvent', Array.from({ length: 100 }, (_, i) => ({
    id: `ce-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    eventName: rng.pick(['Spring Careers Fair', 'Industry Insight Day', 'Networking Evening', 'Employer Visit']),
    eventDate: now,
    location: rng.chance(0.7) ? 'Main Campus' : 'Virtual',
    description: 'Careers and employability event.',
    maxAttendees: rng.int(50, 500),
    registrations: rng.int(30, 400),
  })));

  // GraduateOutcome — for alumni
  const alumni = ctx.ids.studentIds.filter(s => s.isAlumni);
  ctx.append('GraduateOutcome', alumni.slice(0, 10000).map((stu) => ({
    id: `go-${stu.id.slice(4)}`, ...audit,
    graduandId: `grand-${stu.id.slice(4)}`,
    surveyDate: '2026-03-01T00:00:00Z',
    employmentStatus: rng.weighted([['EMPLOYED', 65], ['STUDYING', 15], ['SELF_EMPLOYED', 8],
      ['UNEMPLOYED', 5], ['OTHER', 7]]),
    jobTitle: rng.chance(0.7) ? rng.pick(['Software Engineer', 'Accountant', 'Teacher', 'Researcher', 'Analyst', 'Consultant']) : null,
    salary: rng.int(22_000, 45_000),
  })));

  // GraduateOutcomesResponse — similar (full DLHE/GOS shape)
  const gosBatch = [];
  for (let i = 0; i < alumni.length; i++) {
    const stu = alumni[i];
    gosBatch.push({
      id: `gor-${stu.id.slice(4)}`, createdAt: now, updatedAt: now,
      surveyId: 'gos-2026',
      studentId: stu.id, graduationYear: 2024,
      responseDate: '2026-03-01T00:00:00Z',
      employmentStatus: rng.weighted([['FULL_TIME_EMPLOYED', 60], ['PART_TIME_EMPLOYED', 10],
        ['UNEMPLOYED', 5], ['FURTHER_STUDY', 18], ['OTHER', 7]]),
      employerName: 'Employer Ltd', jobTitle: 'Graduate role', salary: rng.int(22000, 45000),
      salaryBand: '£25k-£30k', soc2020Code: '2311', industryCode: 'P',
      qualificationRelevance: rng.int(3, 5), overallSatisfaction: rng.int(3, 5),
    });
    if (gosBatch.length >= BATCH) flush(ctx, 'GraduateOutcomesResponse', gosBatch);
  }
  flush(ctx, 'GraduateOutcomesResponse', gosBatch);

  ctx.append('GraduateOutcomesMetrics', ctx.ids.programmeIds.slice(0, 200).map((p, i) => ({
    id: `gom-${p.id.slice(5)}`, createdAt: now, updatedAt: now,
    programmeId: p.id, graduationYear: 2024,
    responseRate: rng.float(0.4, 0.9).toFixed(2),
    employmentRate: rng.float(0.7, 0.95).toFixed(2),
    furtherStudyRate: rng.float(0.05, 0.25).toFixed(2),
    averageSalary: rng.int(24000, 42000).toFixed(2),
    satisfactionScore: rng.float(3.5, 4.7).toFixed(1),
    highlySkilled: rng.float(0.6, 0.92).toFixed(2),
    sampleSize: rng.int(20, 200),
  })));

  ctx.append('AlumniRecord', alumni.slice(0, 12000).map((stu) => ({
    id: `alr-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, graduationYear: 2020 + (parseInt(stu.id.slice(-1), 16) % 5),
    alumniStatus: 'ACTIVE',
    currentRole: 'Professional Role', employer: 'Employer Ltd',
    email: `${stu.id.slice(4)}@alumni.fhe.ac.uk`,
    phone: null,
  })));

  ctx.append('AlumniEvent', Array.from({ length: 2000 }, (_, i) => {
    const stu = alumni[i % alumni.length];
    return {
      id: `ae-${(i + 1).toString().padStart(5, '0')}`, ...audit,
      alumniId: `alr-${stu.id.slice(4)}`,
      eventName: rng.pick(['Alumni Reunion 2025', 'Networking Dinner', 'Career Mentoring Day']),
      eventDate: now, attended: rng.chance(0.65),
    };
  }));

  ctx.append('AlumniDonation', Array.from({ length: 800 }, (_, i) => {
    const stu = alumni[i % alumni.length];
    return {
      id: `ad-${(i + 1).toString().padStart(4, '0')}`, ...audit,
      alumniId: `alr-${stu.id.slice(4)}`,
      amount: rng.weighted([[50, 30], [100, 25], [250, 20], [500, 15], [1000, 10]]).toFixed(2),
      currency: 'GBP', donationDate: now,
      purpose: rng.pick(['Hardship fund', 'Scholarship fund', 'Capital appeal', 'Unrestricted']),
    };
  }));

  // ─── PGR ─────────────────────────────────────────────────────────────────
  const pgrStudents = ctx.ids.studentIds.filter(s => s.level === 'PGR');
  const pgrRegistrations = [];
  const pgrSupervisors = [];
  const pgrMilestones = [];
  const pgrReviews = [];
  const pgrVivas = [];
  const pgrTheses = [];
  for (let i = 0; i < pgrStudents.length; i++) {
    const stu = pgrStudents[i];
    const regId = `pgr-${stu.id.slice(4)}`;
    pgrRegistrations.push({
      id: regId, ...audit,
      studentId: stu.id, programmeId: stu.programmeId,
      registrationDate: '2023-09-01T00:00:00Z',
      expectedCompletion: '2026-09-01T00:00:00Z',
      thesisTitle: `Thesis ${i + 1}: ${rng.pick(['Investigations in', 'Studies on', 'Approaches to', 'A novel framework for'])} ${rng.pick(['contemporary practice', 'computational methods', 'historical understanding', 'theoretical foundations'])}`,
    });
    pgrSupervisors.push({
      id: `pgrs-${regId.slice(4)}-1`, ...audit,
      registrationId: regId, supervisorName: 'Director of Studies',
      supervisorEmail: 'dos@fhe.ac.uk', role: 'PRIMARY',
      allocationDate: now, endDate: null,
    });
    pgrSupervisors.push({
      id: `pgrs-${regId.slice(4)}-2`, ...audit,
      registrationId: regId, supervisorName: 'Second Supervisor',
      supervisorEmail: 'second.sup@fhe.ac.uk', role: 'SECONDARY',
      allocationDate: now, endDate: null,
    });
    ['Confirmation of Registration', 'Mid-point Review', 'Pre-submission Review', 'Thesis Submission'].forEach((name, j) => {
      pgrMilestones.push({
        id: `pgrm-${regId.slice(4)}-${j + 1}`, ...audit,
        registrationId: regId, name, targetDate: now,
        completionDate: j < 2 ? now : null,
        status: j < 2 ? 'COMPLETED' : 'PENDING',
      });
    });
    for (let y = 1; y <= 3; y++) {
      pgrReviews.push({
        id: `pgrr-${regId.slice(4)}-y${y}`, ...audit,
        registrationId: regId, reviewYear: y, reviewDate: now,
        reportSubmitted: y < 3 ? now : null,
        outcome: y < 3 ? 'PROCEED' : 'PENDING',
        feedback: 'Continuing satisfactory progress.',
      });
    }
    if (rng.chance(0.3)) {
      pgrVivas.push({
        id: `pgrv-${regId.slice(4)}`, ...audit,
        registrationId: regId, vivaDate: now,
        examiners: 'Internal: Dr X; External: Prof Y',
        outcome: rng.weighted([['PASS', 40], ['PASS_WITH_MINOR', 35], ['PASS_WITH_MAJOR', 20], ['REFER', 5]]),
        revisionDeadline: '2027-09-01T00:00:00Z',
      });
      pgrTheses.push({
        id: `pgrt-${regId.slice(4)}`, ...audit,
        registrationId: regId,
        title: `Doctoral thesis by candidate ${i + 1}`,
        submissionDate: now,
        fileName: `thesis-${regId}.pdf`,
        fileUrl: `minio://documents/theses/${regId}.pdf`,
        wordCount: rng.int(60000, 100000),
      });
    }
  }
  ctx.append('PgrRegistration', pgrRegistrations);
  ctx.append('PgrSupervisor', pgrSupervisors);
  ctx.append('PgrMilestone', pgrMilestones);
  ctx.append('PgrAnnualReview', pgrReviews);
  ctx.append('PgrVivaRecord', pgrVivas);
  ctx.append('PgrThesis', pgrTheses);

  // ─── comms ─────────────────────────────────────────────────────────────
  ctx.append('StudentCommunication', ctx.ids.studentIds.slice(0, 10000).map((stu, i) => ({
    id: `comm-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, templateId: 'commtpl-enrolment_complete',
    sentDate: now, communicationType: 'EMAIL',
    recipientAddress: `${stu.id.slice(4)}@student.fhe.ac.uk`,
    subject: 'Welcome to Future Horizons University',
    content: 'Your enrolment is complete. Please check your portal.',
    status: 'DELIVERED',
  })));

  const notifBatch = [];
  for (let i = 0; i < ctx.ids.studentIds.length && i < 30000; i++) {
    const stu = ctx.ids.studentIds[i];
    notifBatch.push({
      id: `notif-${stu.id.slice(4)}`, ...audit,
      studentId: stu.id, title: 'New module results available',
      message: 'Your latest assessment results have been released.',
      notificationType: 'RESULT', isRead: rng.chance(0.7),
      readAt: rng.chance(0.7) ? now : null,
      actionUrl: '/portal/results',
    });
    if (notifBatch.length >= BATCH) flush(ctx, 'Notification', notifBatch);
  }
  flush(ctx, 'Notification', notifBatch);

  ctx.append('NotificationPreference', ctx.ids.studentIds.slice(0, 20000).flatMap((stu) =>
    ['RESULT', 'FEE', 'EVENT'].map((type) => ({
      id: `np-${stu.id.slice(4)}-${type.toLowerCase()}`, ...audit,
      studentId: stu.id, notificationType: type, isEnabled: rng.chance(0.85),
    }))));

  // ─── research (REF / KEF) ──────────────────────────────────────────────
  const refSubmissions = [];
  for (let i = 1; i <= 12; i++) {
    refSubmissions.push({
      id: `refs-${i.toString().padStart(2, '0')}`, ...audit,
      submissionCycle: '2029', submissionDate: '2028-11-30T00:00:00Z',
      unitOfAssessment: `UoA${i}`, staffCount: rng.int(15, 60),
    });
  }
  ctx.append('RefSubmission', refSubmissions);
  ctx.append('RefOutput', Array.from({ length: 2500 }, (_, i) => ({
    id: `refo-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    submissionId: refSubmissions[i % 12].id,
    title: `Research output ${i + 1}: ${rng.pick(['A novel approach to', 'Insights into', 'Investigations of', 'A study of'])} ${rng.pick(['contemporary issues', 'theoretical foundations', 'practical applications', 'comparative analysis'])}`,
    authors: 'Author A; Author B; Author C',
    publicationDate: '2024-06-15T00:00:00Z',
    type: rng.pick(['JOURNAL_ARTICLE', 'BOOK', 'CHAPTER', 'CONFERENCE_PAPER', 'CREATIVE_WORK']),
    doi: `10.1234/sample.${i + 1}`,
    url: `https://doi.org/10.1234/sample.${i + 1}`,
  })));
  ctx.append('RefImpactCase', Array.from({ length: 60 }, (_, i) => ({
    id: `refic-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    submissionId: refSubmissions[i % 12].id,
    title: `Impact case study ${i + 1}`,
    description: 'Research contributing to policy / practice / public benefit.',
    underpinningResearch: '4-page underpinning research narrative',
    impactAreas: rng.pick(['POLICY', 'PRACTICE', 'PUBLIC_BENEFIT', 'COMMERCIAL']),
  })));
  ctx.append('RefEnvironmentStatement', refSubmissions.map((rs) => ({
    id: `refe-${rs.id.slice(5)}`,
    createdAt: now, updatedAt: now, deletedAt: null,
    submissionId: rs.id, unitOfAssessment: rs.unitOfAssessment, period: '2014-2021',
    staffFte: rs.staffCount * 0.8, doctoralAwards: rng.int(10, 50),
    researchIncome: (rng.int(500000, 5000000)).toString(),
    narrative: 'Vibrant research environment supporting interdisciplinary work.',
    infrastructure: 'Dedicated labs, library, computing resources.',
    collaborations: 'Industry, NHS, Government, international partners.',
    status: 'SUBMITTED',
  })));
  ctx.append('RefStaffReturn', Array.from({ length: 500 }, (_, i) => ({
    id: `refsr-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    submissionId: refSubmissions[i % 12].id,
    staffId: ctx.ids.staffIds[i % ctx.ids.staffIds.length]?.id ?? 'staff-unknown',
    unitOfAssessment: `UoA${(i % 12) + 1}`, period: '2014-2021',
    category: rng.pick(['A', 'B', 'C']), fte: 1.0,
    researchConnection: 'Independent researcher',
  })));
  ctx.append('RefSubmissionSummary', refSubmissions.map((rs) => ({
    id: `refss-${rs.id.slice(5)}`,
    createdAt: now, updatedAt: now,
    period: '2014-2021', unitOfAssessment: rs.unitOfAssessment,
    totalOutputs: rng.int(100, 300), totalImpactCases: rng.int(2, 8),
    staffFte: rs.staffCount * 0.8,
    overallQuality: rng.weighted([['4*', 20], ['3*', 50], ['2*', 25], ['1*', 5]]),
    status: 'SUBMITTED', submittedAt: now,
  })));
  ctx.append('KefPerspective', Array.from({ length: 7 }, (_, i) => ({
    id: `kefp-${i + 1}`, ...audit,
    name: ['Research partnerships', 'Working with business', 'Working with the public sector',
      'Skills, enterprise and entrepreneurship', 'Local growth and regeneration',
      'IP and commercialisation', 'Public and community engagement'][i],
    academicYear: CURRENT_ACTIVE_YEAR,
    perspective: `Perspective ${i + 1} narrative`,
  })));
  ctx.append('KefMetric', Array.from({ length: 60 }, (_, i) => ({
    id: `kefm-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    perspectiveId: `kefp-${(i % 7) + 1}`,
    perspective: `Perspective ${(i % 7) + 1}`,
    metricName: `Metric ${i + 1}`, value: rng.int(10, 100).toString(),
    benchmark: rng.int(20, 80).toString(), year: 2024, source: 'HESA',
  })));
  ctx.append('KefNarrative', Array.from({ length: 7 }, (_, i) => ({
    id: `kefn-${i + 1}`, createdAt: now, updatedAt: now,
    perspective: `Perspective ${i + 1}`, year: 2024,
    content: 'KEF narrative content describing institutional strengths and areas for development.',
    evidenceLinks: '[]', status: 'SUBMITTED',
  })));
  ctx.append('KefDashboardSummary', [{
    id: 'kefdash-2024', createdAt: now, updatedAt: now,
    year: 2024, cluster: 'large', overallScore: 'HIGH',
    perspectiveScores: '{"P1": "HIGH", "P2": "MEDIUM"}',
    strengths: 'Strong industry engagement; vibrant doctoral training.',
    areasForDevelopment: 'Public engagement metrics.',
  }]);

  // ─── regulatory (HESA + OfS + UKVI) ───────────────────────────────────
  const hesaReturns = ACADEMIC_YEARS.slice(0, 5).map((ay, i) => ({
    id: `hr-${ay.replace('/', '')}`, ...audit,
    returnType: 'STUDENT', academicYearId: ctx.ids.academicYearIdByLabel.get(ay),
    academicYear: ay, status: 'SUBMITTED',
    submissionDeadline: ayEndDate(ay) + 'T00:00:00Z',
    submittedAt: ayEndDate(ay) + 'T00:00:00Z',
    submittedBy: 'registrar@fhe.ac.uk',
    totalRecords: 40000, validRecords: 39800,
    errorCount: 5, warningCount: 195,
    hesaReferenceNo: `HESA-${i + 1}-2025`,
    responseData: '{}',
    notes: 'Submitted on time.',
  }));
  ctx.append('HesaReturn', hesaReturns);
  ctx.append('HesaReturnError', Array.from({ length: 100 }, (_, i) => ({
    id: `hre-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, returnId: hesaReturns[i % hesaReturns.length].id,
    errorCode: `E${(i % 20).toString().padStart(3, '0')}`, errorLevel: rng.pick(['ERROR', 'WARNING']),
    entityType: 'STUDENT', entityId: ctx.ids.studentIds[i].id,
    fieldName: 'POSTCODE', message: 'Invalid postcode format',
    resolvedAt: rng.chance(0.7) ? now : null,
    resolvedBy: rng.chance(0.7) ? 'registrar@fhe.ac.uk' : null,
  })));

  const hesaSnapshots = hesaReturns.map((r) => ({
    id: `hrs-${r.id.slice(3)}`, ...audit,
    returnId: r.id, snapshotDate: r.submittedAt, status: 'SUBMITTED',
    codingFrameVersionId: 'cfv-HESA_ETHNIC-v2020.1',
    totalLearners: 40000, totalEngagements: 40000,
    totalModules: 3000, totalQualifications: 600,
    xmlPayload: null, checksum: 'sha256:fakechecksum',
    extractionDuration: rng.int(60, 600),
  }));
  ctx.append('HesaReturnSnapshot', hesaSnapshots);

  // HesaLearner — sample 20,000 students for the most recent snapshot
  const sampleLearners = ctx.ids.studentIds.slice(0, 20000);
  const hesaLearnerBatch = [];
  for (const stu of sampleLearners) {
    hesaLearnerBatch.push({
      id: `hl-${stu.id.slice(4)}`, createdAt: now,
      snapshotId: hesaSnapshots[hesaSnapshots.length - 1].id,
      studentId: stu.id, husid: stu.husid ?? '20000000000000',
      numhus: stu.husid?.slice(0, 13) ?? '2000000000000',
      ownStu: stu.id, surname: 'Lastname', fnames: 'Firstname',
      birthDate: '2002-01-01T00:00:00Z', sexId: '1',
      ethnicId: '01', disabilityId: '00', nationCode: 'GB',
      domicile: 'GB-ENG', postcode: 'M1 1AA',
      qualEnt3: 'A_LEVEL', feeElig: 'HOME', ucasPerid: null,
      pared: null, ssn: null,
    });
    if (hesaLearnerBatch.length >= BATCH) flush(ctx, 'HesaLearner', hesaLearnerBatch);
  }
  flush(ctx, 'HesaLearner', hesaLearnerBatch);

  ctx.append('HesaEngagement', sampleLearners.slice(0, 20000).map((stu, i) => ({
    id: `he-${stu.id.slice(4)}`, createdAt: now,
    snapshotId: hesaSnapshots[hesaSnapshots.length - 1].id,
    learnerId: `hl-${stu.id.slice(4)}`,
    enrolmentId: null, engagementId: `eng-${i}`,
    courseId: stu.programmeId, comDate: '2024-09-23T00:00:00Z',
    endDate: null, rsnEnd: '00',
    modeOfStudy: 'FT', studyLoad: 1.0, fundComp: 'COMPLETED',
    typeOfYear: 'STANDARD', yearPrg: 1,
    feeRegime: 'HOME', specFee: 'N', grossFee: '9250',
    netFee: '9250', initiatives: null,
  })));

  ctx.append('HesaStudentCourseSession', sampleLearners.slice(0, 20000).map((stu) => ({
    id: `hscs-${stu.id.slice(4)}`, createdAt: now,
    snapshotId: hesaSnapshots[hesaSnapshots.length - 1].id,
    engagementId: `he-${stu.id.slice(4)}`,
    instancePeriodId: null, sessionYear: '2025/26',
    typeOfYear: 'STANDARD', modeOfStudy: 'FT', fundComp: 'COMPLETED',
    studyLoad: 1.0, yearPrg: 1,
    startDate: '2025-09-23T00:00:00Z', endDate: '2026-08-31T00:00:00Z',
  })));

  ctx.append('HesaModuleSnapshot', ctx.ids.moduleIds.slice(0, 3000).map((m) => ({
    id: `hms-${m.code.toLowerCase()}`, createdAt: now,
    snapshotId: hesaSnapshots[hesaSnapshots.length - 1].id,
    moduleId: m.id, hesaModuleId: `HM${m.code}`,
    moduleTitle: m.code, credits: 20, creditLevel: m.fheq.toString(),
    modStat: 'A', modOut: null,
  })));

  ctx.append('HesaModuleSubject', ctx.ids.moduleIds.slice(0, 3000).map((m) => ({
    id: `hmsub-${m.code.toLowerCase()}`, createdAt: now,
    moduleSnapId: `hms-${m.code.toLowerCase()}`,
    hecosCode: '100346', percentage: 100,
  })));

  ctx.append('HesaQualificationSnapshot', ctx.ids.programmeIds.slice(0, 600).map((p) => ({
    id: `hqs-${p.id.slice(5)}`, createdAt: now,
    snapshotId: hesaSnapshots[hesaSnapshots.length - 1].id,
    programmeId: p.id, courseId: p.code,
    courseTitle: p.name, courseAim: 'F40', fheqLevel: p.fheq.toString(),
    ttcid: null,
  })));

  ctx.append('HesaQualificationSubject', ctx.ids.programmeIds.slice(0, 600).map((p) => ({
    id: `hqsub-${p.id.slice(5)}`, createdAt: now,
    qualificationId: `hqs-${p.id.slice(5)}`,
    hecosCode: '100346', percentage: 100,
  })));

  ctx.append('HesaSubmissionRun', hesaSnapshots.map((s, i) => ({
    id: `hsr-${i + 1}`, createdAt: now,
    snapshotId: s.id, submittedAt: now, submittedBy: 'registrar@fhe.ac.uk',
    hesaEndpoint: 'https://api.hesa.ac.uk/data/student',
    httpStatus: 200, hesaResponse: 'Accepted',
    hesaReferenceNo: `HESA-RUN-${i + 1}`, accepted: true, errorMessage: null,
  })));

  ctx.append('HesaValidationResult', Array.from({ length: 1000 }, (_, i) => ({
    id: `hvr-${(i + 1).toString().padStart(4, '0')}`, createdAt: now,
    snapshotId: hesaSnapshots[i % hesaSnapshots.length].id,
    entityType: 'STUDENT', entityId: ctx.ids.studentIds[i].id,
    fieldName: 'POSTCODE', ruleCode: 'HQ03', severity: 'WARNING',
    message: 'Postcode format requires review',
    resolvedAt: rng.chance(0.8) ? now : null,
    resolvedBy: rng.chance(0.8) ? 'registrar@fhe.ac.uk' : null,
    overrideNote: null,
  })));

  ctx.append('OfsCondition', Array.from({ length: 12 }, (_, i) => ({
    id: `ofsc-${(i + 1).toString().padStart(2, '0')}`, ...audit,
    conditionCode: `C${i + 1}`, conditionName: `Condition of registration ${i + 1}`,
    description: 'OfS condition of registration narrative',
    riskLevel: rng.weighted([['LOW', 70], ['MEDIUM', 25], ['HIGH', 5]]),
  })));
  ctx.append('OfsReportableEvent', Array.from({ length: 30 }, (_, i) => ({
    id: `ofsre-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    eventType: rng.pick(['MATERIAL_CHANGE', 'INTERVENTION', 'INVESTIGATION', 'CHANGE_OF_OWNERSHIP']),
    eventDate: now, description: 'Reportable event narrative',
    notifiedAt: now, ofsAcknowledged: rng.chance(0.8),
  })));
  ctx.append('TefMetric', Array.from({ length: 20 }, (_, i) => ({
    id: `tef-${(i + 1).toString().padStart(2, '0')}`,
    createdAt: now, updatedAt: now,
    metricName: rng.pick(['Continuation', 'Completion', 'Progression', 'NSS satisfaction']),
    value: rng.float(0.7, 0.95).toFixed(3),
    benchmark: rng.float(0.65, 0.9).toFixed(3),
    band: rng.weighted([['GOLD', 30], ['SILVER', 50], ['BRONZE', 20]]),
    year: 2024,
  })));
  ctx.append('StatutoryReturn', Array.from({ length: 8 }, (_, i) => ({
    id: `sr-${(i + 1).toString().padStart(2, '0')}`,
    createdAt: now, updatedAt: now,
    returnType: rng.pick(['HESA', 'OFS_FINANCE', 'UKVI', 'CASS_RETURN']),
    submissionDate: now, status: 'SUBMITTED',
    notes: 'Returned on time.',
  })));

  // UKVI / international
  const intStudents = ctx.ids.studentIds.filter(s => s.fee === 'OVERSEAS').slice(0, 1500);
  ctx.append('VisaRecord', intStudents.map((stu, i) => ({
    id: `vr-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, visaType: 'STUDENT',
    issuedDate: '2025-08-01T00:00:00Z',
    expiryDate: '2026-12-31T00:00:00Z',
    visaNumber: `VR${(i + 1).toString().padStart(6, '0')}`,
    status: 'ACTIVE',
  })));
  ctx.append('UkviReport', Array.from({ length: 24 }, (_, i) => ({
    id: `ukvir-${(i + 1).toString().padStart(2, '0')}`,
    createdAt: now, updatedAt: now,
    reportPeriod: `2025-Q${(i % 4) + 1}`,
    submissionDate: now,
    studentsReported: 1500, sponsorshipCompliance: 'COMPLIANT',
  })));
  ctx.append('UkviContactPoint', Array.from({ length: 10 }, (_, i) => ({
    id: `ukvicp-${i + 1}`, createdAt: now, updatedAt: now,
    name: `Contact point ${i + 1}`, role: 'Sponsorship lead',
    email: `ukvi.contact${i + 1}@fhe.ac.uk`,
  })));
  ctx.append('CasRecord', intStudents.map((stu, i) => ({
    id: `cas-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id, casNumber: `CAS${(i + 1).toString().padStart(8, '0')}`,
    issuedDate: '2025-07-01T00:00:00Z',
    expiryDate: '2026-09-30T00:00:00Z',
    status: 'ASSIGNED',
  })));
  ctx.append('InternationalPartnership', Array.from({ length: 50 }, (_, i) => ({
    id: `ip-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    partnerName: `International Partner University ${i + 1}`,
    country: rng.pick(['China', 'India', 'USA', 'France', 'Germany', 'Spain']),
    partnershipType: rng.pick(['EXCHANGE', 'DUAL_DEGREE', 'RESEARCH', 'SUMMER_SCHOOL']),
    startDate: '2020-09-01T00:00:00Z', endDate: '2030-08-31T00:00:00Z',
    status: 'ACTIVE',
  })));
  ctx.append('StudentExchange', Array.from({ length: 500 }, (_, i) => ({
    id: `se-${(i + 1).toString().padStart(4, '0')}`, ...audit,
    studentId: ctx.ids.studentIds[i * 80 % ctx.ids.studentIds.length].id,
    partnerInstitution: `Partner University ${(i % 50) + 1}`,
    exchangeType: 'OUTBOUND', startDate: '2025-09-01T00:00:00Z',
    endDate: '2026-05-31T00:00:00Z', creditsTransferred: 60,
  })));

  ctx.append('DataChangeLog', Array.from({ length: 1000 }, (_, i) => ({
    id: `dcl-${(i + 1).toString().padStart(5, '0')}`,
    createdAt: now, updatedAt: now,
    entityType: 'Student', entityId: ctx.ids.studentIds[i].id,
    fieldName: 'email', oldValue: 'old@example.com', newValue: 'new@example.com',
    changedAt: now, changedBy: ctx.seedActor, source: 'PORTAL',
  })));
  ctx.append('DataQualityLog', Array.from({ length: 500 }, (_, i) => ({
    id: `dql-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    ruleId: `dqr-${(i % 20) + 1}`, entityType: 'STUDENT',
    entityId: ctx.ids.studentIds[i].id,
    status: rng.weighted([['PASS', 70], ['WARN', 25], ['FAIL', 5]]),
    detectedAt: now,
  })));
  ctx.append('DataQualityRule', Array.from({ length: 30 }, (_, i) => ({
    id: `dqr-${i + 1}`, ...audit,
    ruleName: `Data quality rule ${i + 1}`, ruleType: 'VALIDATION',
    entityType: 'STUDENT', severity: 'MEDIUM',
    ruleDefinition: 'Field must match pattern',
  })));
  ctx.append('DataQualityAlert', Array.from({ length: 200 }, (_, i) => ({
    id: `dqa-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    ruleId: `dqr-${(i % 30) + 1}`, alertLevel: 'AMBER',
    message: 'Data quality threshold exceeded',
    raisedAt: now, isResolved: rng.chance(0.7),
  })));
  ctx.append('DataQualityBatchRun', Array.from({ length: 50 }, (_, i) => ({
    id: `dqb-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    runDate: now, recordsScanned: 50000,
    issuesDetected: rng.int(10, 200), status: 'COMPLETED',
    duration: rng.int(60, 600),
  })));
  ctx.append('ValidationEvent', Array.from({ length: 500 }, (_, i) => ({
    id: `ve-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    entityType: 'PROGRAMME', entityId: ctx.ids.programmeIds[i % ctx.ids.programmeIds.length]?.id ?? 'unknown',
    eventType: 'APPROVAL', triggeredAt: now,
  })));

  // ─── GDPR / data protection ───────────────────────────────────────────
  ctx.append('RetentionPolicy', Array.from({ length: 12 }, (_, i) => ({
    id: `rp-${(i + 1).toString().padStart(2, '0')}`, ...audit,
    policyName: `Retention policy ${i + 1}`,
    entityType: rng.pick(['STUDENT_RECORD', 'STAFF_RECORD', 'APPLICATION', 'PAYMENT', 'AUDIT_LOG']),
    retentionYears: rng.pick([7, 25, 100]),
    deletionMethod: 'SECURE_DELETE',
  })));
  ctx.append('RetentionScheduleEvent', Array.from({ length: 200 }, (_, i) => ({
    id: `rse-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    policyId: `rp-${(i % 12) + 1}`,
    scheduledAt: now, status: 'COMPLETED',
    recordsAffected: rng.int(1, 100),
  })));
  ctx.append('SensitiveFieldAccessLog', Array.from({ length: 500 }, (_, i) => ({
    id: `sfal-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now,
    entityType: 'Student', entityId: ctx.ids.studentIds[i].id,
    fieldName: rng.pick(['dateOfBirth', 'ethnicity', 'disability', 'sexualOrientation']),
    accessedBy: ctx.seedActor, accessedAt: now,
    purpose: 'HESA return generation',
  })));
  ctx.append('BreakGlassApproval', Array.from({ length: 20 }, (_, i) => ({
    id: `bga-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    requestedBy: 'staff@fhe.ac.uk', approvedBy: 'dpo@fhe.ac.uk',
    reason: 'Safeguarding incident — urgent access',
    grantedAt: now, expiresAt: now, isApproved: true,
  })));
  ctx.append('DataSubjectRequest', Array.from({ length: 200 }, (_, i) => ({
    id: `dsar-${(i + 1).toString().padStart(4, '0')}`, ...audit,
    studentId: ctx.ids.studentIds[i * 250 % ctx.ids.studentIds.length].id,
    requestType: rng.pick(['ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY']),
    receivedDate: now, completedDate: rng.chance(0.7) ? now : null,
    status: rng.weighted([['COMPLETED', 70], ['IN_PROGRESS', 25], ['REJECTED', 5]]),
  })));
  ctx.append('DisclosureRecord', Array.from({ length: 50 }, (_, i) => ({
    id: `dr-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    studentId: ctx.ids.studentIds[i].id,
    discloseToType: rng.pick(['POLICE', 'COURT', 'PARENT', 'SAFEGUARDING_PARTNER']),
    disclosureDate: now, lawfulBasis: 'LEGAL_OBLIGATION',
    description: 'Disclosure under safeguarding policy',
  })));
  ctx.append('BreachIncident', Array.from({ length: 8 }, (_, i) => ({
    id: `bi-${(i + 1).toString().padStart(2, '0')}`, ...audit,
    incidentDate: now, reportedDate: now,
    severity: rng.weighted([['LOW', 60], ['MEDIUM', 30], ['HIGH', 10]]),
    description: 'Data protection incident review',
    affectedDataSubjects: rng.int(1, 1000),
    icoNotified: rng.chance(0.3), icoReferenceNo: null,
    resolvedDate: now,
  })));
  ctx.append('ReportDefinition', Array.from({ length: 30 }, (_, i) => ({
    id: `rdef-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    name: `Standard report ${i + 1}`, reportType: 'OPERATIONAL',
    sqlTemplate: 'SELECT ...', parameterSchema: '{}',
    isActive: true,
  })));
  ctx.append('ReportInstance', Array.from({ length: 300 }, (_, i) => ({
    id: `rinst-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: ctx.seedActor,
    definitionId: `rdef-${(i % 30) + 1}`,
    generatedAt: now, status: 'COMPLETED',
    rowCount: rng.int(10, 5000),
    outputUrl: `minio://reports/${i + 1}.csv`,
  })));

  // ─── misc ─────────────────────────────────────────────────────────────
  ctx.append('SurveyTemplate', Array.from({ length: 10 }, (_, i) => ({
    id: `st-${(i + 1).toString().padStart(2, '0')}`, ...audit,
    name: ['NSS', 'PTES', 'PRES', 'Module evaluation', 'Welcome week', 'PG taught experience',
      'PG research experience', 'Exit survey', 'Employability', 'Wellbeing'][i],
    description: 'Standard survey template',
    questions: '[{"id":"q1","text":"How satisfied?","type":"LIKERT"}]',
    isActive: true,
  })));
  ctx.append('SurveyInstance', Array.from({ length: 50 }, (_, i) => ({
    id: `si-${(i + 1).toString().padStart(3, '0')}`, ...audit,
    templateId: `st-${(i % 10 + 1).toString().padStart(2, '0')}`,
    academicYearId: ctx.ids.academicYears[i % 5]?.id ?? null,
    openDate: now, closeDate: now, status: 'CLOSED',
  })));
  ctx.append('SurveyResponse', Array.from({ length: 20000 }, (_, i) => ({
    id: `sr-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    instanceId: `si-${(i % 50 + 1).toString().padStart(3, '0')}`,
    respondentId: ctx.ids.studentIds[i % ctx.ids.studentIds.length].id,
    submittedAt: now,
    responses: '{"q1":4}',
  })));
  ctx.append('SelfServiceRequest', Array.from({ length: 5000 }, (_, i) => ({
    id: `ssr-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    studentId: ctx.ids.studentIds[i * 10 % ctx.ids.studentIds.length].id,
    requestType: rng.pick(['ADDRESS_CHANGE', 'TRANSCRIPT_REQUEST', 'CERTIFICATE_REPLACEMENT', 'LETTER_REQUEST']),
    submittedAt: now, status: rng.weighted([['COMPLETED', 75], ['IN_PROGRESS', 20], ['REJECTED', 5]]),
    completedAt: rng.chance(0.75) ? now : null,
  })));
  ctx.append('WebhookSubscription', Array.from({ length: 20 }, (_, i) => ({
    id: `ws-${(i + 1).toString().padStart(2, '0')}`, ...audit,
    name: `Subscription ${i + 1}`,
    targetUrl: `https://n8n.fhe.ac.uk/webhook/${i + 1}`,
    events: '["enrolment.created","assessment.released"]',
    isActive: true, secretKey: 'sk-placeholder',
  })));
  ctx.append('SystemWorkflowError', Array.from({ length: 100 }, (_, i) => ({
    id: `swe-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    workflowId: `wf-${i % 10}`,
    errorMessage: 'Transient error retried successfully',
    occurredAt: now, retryCount: 1,
  })));
  ctx.append('InterfaceLog', Array.from({ length: 1000 }, (_, i) => ({
    id: `il-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    interfaceName: rng.pick(['UCAS', 'SLC', 'HESA', 'Moodle', 'n8n']),
    direction: rng.pick(['INBOUND', 'OUTBOUND']),
    payloadSize: rng.int(100, 100000), status: 'SUCCESS',
    durationMs: rng.int(50, 5000),
  })));
  ctx.append('WorkflowError', Array.from({ length: 100 }, (_, i) => ({
    id: `we-${(i + 1).toString().padStart(3, '0')}`,
    createdAt: now, updatedAt: now,
    workflowName: `Workflow ${i + 1}`, errorCode: `E${i % 20}`,
    errorMessage: 'Workflow exception caught', occurredAt: now,
  })));

  // ─── timetabling ────────────────────────────────────────────────────────
  ctx.append('TimetableSlot', Array.from({ length: 3000 }, (_, i) => ({
    id: `ts-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    dayOfWeek: rng.int(1, 5), startTime: '09:00', endTime: '11:00',
    weekRange: '1-12', isAvailable: rng.chance(0.7),
  })));
  ctx.append('TimetableEvent', Array.from({ length: 12000 }, (_, i) => ({
    id: `tev-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    moduleId: ctx.ids.moduleIds[i % ctx.ids.moduleIds.length]?.id ?? 'unknown',
    slotId: `ts-${(i % 3000 + 1).toString().padStart(5, '0')}`,
    roomId: ctx.ids.roomIds[i % ctx.ids.roomIds.length]?.id ?? 'unknown',
    staffId: ctx.ids.staffIds[i % ctx.ids.staffIds.length]?.id ?? 'unknown',
    eventType: 'LECTURE', startDateTime: now, endDateTime: now,
  })));
  ctx.append('RoomBooking', Array.from({ length: 6000 }, (_, i) => ({
    id: `rb-${(i + 1).toString().padStart(5, '0')}`, ...audit,
    roomId: ctx.ids.roomIds[i % ctx.ids.roomIds.length]?.id ?? 'unknown',
    bookedBy: 'timetabling@fhe.ac.uk',
    bookedFor: 'Module session',
    startDateTime: now, endDateTime: now, status: 'CONFIRMED',
  })));

  // ─── accommodation booking ─────────────────────────────────────────────
  const accomBookings = [];
  for (let i = 0; i < 6000; i++) {
    const stu = ctx.ids.studentIds[i * 10 % ctx.ids.studentIds.length];
    accomBookings.push({
      id: `ab-${(i + 1).toString().padStart(5, '0')}`, ...audit,
      studentId: stu.id, hallId: `hall-${rng.pick(['beech', 'oak', 'maple', 'cedar', 'birch', 'pine'])}`,
      bookingStart: '2025-09-15T00:00:00Z',
      bookingEnd: '2026-06-30T00:00:00Z',
      status: 'CONFIRMED', totalCost: '5700',
    });
  }
  ctx.append('AccommodationBooking', accomBookings);
  ctx.append('AccommodationPreference', ctx.ids.studentIds.slice(0, 8000).map((stu) => ({
    id: `ap-${stu.id.slice(4)}`, ...audit,
    studentId: stu.id,
    preferredHall: rng.pick(['Beech', 'Oak', 'Maple', 'Cedar']),
    preferredRoomType: rng.pick(['ENSUITE_SINGLE', 'STUDIO', 'SHARED_BATH']),
    smokingPreference: 'NON_SMOKING',
    accessibilityNeeds: rng.chance(0.1) ? 'Wheelchair access' : null,
  })));

  // ─── AI ─────────────────────────────────────────────────────────────────
  const aiConvBatch = [];
  for (let i = 0; i < 2000; i++) {
    aiConvBatch.push({
      id: `aic-${(i + 1).toString().padStart(4, '0')}`,
      createdAt: now, updatedAt: now,
      userId: 'user-vc', conversationType: 'STUDENT_SUPPORT',
      messages: '[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]',
      modelId: 'claude-opus-4-7', tokensUsed: rng.int(500, 5000),
      cost: '0.05',
    });
  }
  ctx.append('AiConversation', aiConvBatch);
  ctx.append('AiIndexedDocument', Array.from({ length: 5000 }, (_, i) => ({
    id: `aid-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    sourcePath: `minio://documents/policy/${i + 1}.pdf`,
    documentType: 'POLICY', indexedAt: now,
    embeddingModel: 'text-embedding-3-large',
  })));
  const chunkBatch = [];
  for (let i = 0; i < 50000; i++) {
    chunkBatch.push({
      id: `aidc-${(i + 1).toString().padStart(5, '0')}`,
      createdAt: now, updatedAt: now,
      documentId: `aid-${(i % 5000 + 1).toString().padStart(4, '0')}`,
      chunkIndex: i % 10, chunkText: `Chunk text snippet ${i + 1}`,
      embedding: null, tokenCount: rng.int(50, 500),
    });
    if (chunkBatch.length >= BATCH) flush(ctx, 'AiDocumentChunk', chunkBatch);
  }
  flush(ctx, 'AiDocumentChunk', chunkBatch);

  // ─── VLE (Moodle) ───────────────────────────────────────────────────────
  ctx.append('MoodleIntegrationMap', ctx.ids.moduleIds.slice(0, 3000).map((m) => ({
    id: `mim-${m.code.toLowerCase()}`,
    createdAt: now, updatedAt: now,
    moduleId: m.id, moodleCourseId: `MOODLE-${m.code}`,
    syncedAt: now, syncStatus: 'SYNCED',
  })));
  ctx.append('MoodleSyncLog', Array.from({ length: 500 }, (_, i) => ({
    id: `msl-${(i + 1).toString().padStart(4, '0')}`,
    createdAt: now, updatedAt: now,
    syncType: 'INCREMENTAL', startedAt: now, completedAt: now,
    recordsSynced: rng.int(10, 500), errorCount: rng.int(0, 3),
    status: 'SUCCESS',
  })));

  ctx.log(domain, `longtail complete — welfare, placements, PGR, comms, research, regulatory, GDPR, misc, timetabling, accommodation, AI, VLE`);
}
