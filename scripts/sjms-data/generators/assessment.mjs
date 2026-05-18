/**
 * assessment generator (D7) — streaming, pre-indexed for performance.
 *
 * Rows are written to ctx.append() one batch at a time inside the inner
 * loops, so JS heap stays small even for the 600k+ submissions cohort.
 * Pre-indexes assessment-by-AY so per-enrolment lookup is O(1) not O(N).
 *
 * Spine + tail volumes target the same shape as the buffered design — see
 * the docstring on the previous revision for the table-by-table sizing.
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ASSESSMENT_TYPES, MARK_DISTRIBUTION_MEAN, MARK_DISTRIBUTION_STDDEV } from '../lib/uk-demographics.mjs';
import { ACADEMIC_YEARS } from '../lib/academic-calendar.mjs';

export const domain = 'assessment';

function classFor(mark) {
  if (mark >= 70) return 'FIRST';
  if (mark >= 60) return 'UPPER_SECOND';
  if (mark >= 50) return 'LOWER_SECOND';
  if (mark >= 40) return 'THIRD';
  if (mark >= 35) return 'PASS';
  return 'FAIL';
}

const BATCH = 5000;

function flushBatch(ctx, model, batch) {
  if (batch.length) { ctx.append(model, batch); batch.length = 0; }
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = ctx.audit(now);
  const rng = ctx.rng.fork('assessment');

  const targetAYs = ACADEMIC_YEARS.slice(2, 6);  // 2022/23..2025/26

  // 1. Assessment + AnonymousMarking + AssessmentCriteria, batched
  let assBatch = [], anonBatch = [], criteriaBatch = [];
  const assessmentsByAyId = new Map();  // ayId → [{id, moduleId, weight}, ...]
  for (const ay of targetAYs) assessmentsByAyId.set(ctx.ids.academicYearIdByLabel.get(ay), []);

  for (const m of ctx.ids.moduleIds) {
    if (m.fheq === 8) continue;
    for (const ay of targetAYs) {
      const ayId = ctx.ids.academicYearIdByLabel.get(ay);
      const numComponents = rng.weighted([[1, 20], [2, 60], [3, 20]]);
      for (let c = 0; c < numComponents; c++) {
        const id = `assess-${m.code.toLowerCase()}-${ay.replace('/', '')}-${c + 1}`;
        const assessmentType = rng.pick(ASSESSMENT_TYPES);
        const weight = numComponents === 1 ? 100 : c === 0 ? 60 : 40;
        assBatch.push({
          id, ...audit, moduleId: m.id, assessmentType,
          title: `${assessmentType.replace(/_/g, ' ')} (${ay})`,
          weightPercent: weight, dueDate: null,
          durationMinutes: assessmentType === 'EXAM' ? 120 : null,
          wordCount: ['ESSAY', 'COURSEWORK'].includes(assessmentType) ? 2000 : null,
          passMark: 40, resitType: 'RESUBMISSION', cappedMark: 40,
          academicYearId: ayId,
        });
        anonBatch.push({
          id: `am-${id.slice(7)}`, ...audit,
          assessmentId: id, anonymousCode: `ANON-${rng.int(100000, 999999)}`, enabled: true,
        });
        for (let cr = 0; cr < 2; cr++) {
          criteriaBatch.push({
            id: `ac-${id.slice(7)}-${cr + 1}`, ...audit, assessmentId: id,
            criterion: rng.pick(['Argument and analysis', 'Critical engagement', 'Research depth', 'Writing & presentation']),
            weightPercent: 50, descriptors: 'Banded marking per institutional rubric',
          });
        }
        assessmentsByAyId.get(ayId).push({ id, moduleId: m.id, weight });
        ctx.ids.assessmentIds.push({ id, moduleId: m.id, ayId, weight });
        if (assBatch.length >= BATCH) {
          flushBatch(ctx, 'Assessment', assBatch);
          flushBatch(ctx, 'AnonymousMarking', anonBatch);
          flushBatch(ctx, 'AssessmentCriteria', criteriaBatch);
        }
      }
    }
  }
  flushBatch(ctx, 'Assessment', assBatch);
  flushBatch(ctx, 'AnonymousMarking', anonBatch);
  flushBatch(ctx, 'AssessmentCriteria', criteriaBatch);
  ctx.log(domain, `${ctx.ids.assessmentIds.length.toLocaleString()} assessment instances created`);

  // 2. ExamBoard + ExternalExaminerReport — one per dept × AY
  const departments = [...ctx.ids.departmentByCode.values()];
  const ebBatch = [], eeRepBatch = [];
  const examBoardIdByDeptAy = new Map();
  for (const dept of departments) {
    for (const ay of targetAYs) {
      const ebId = `eb-${dept.code.toLowerCase()}-${ay.replace('/', '')}`;
      examBoardIdByDeptAy.set(`${dept.id}|${ay}`, ebId);
      const ayId = ctx.ids.academicYearIdByLabel.get(ay);
      ebBatch.push({
        id: ebId, ...audit,
        boardName: `${dept.name} Examination Board ${ay}`,
        boardType: 'PROGRAMME', academicYearId: ayId,
        meetingDate: `${2000 + parseInt(ay.split('/')[1], 10)}-06-15T10:00:00Z`,
        chairName: 'External Examiner', isComplete: true,
      });
      eeRepBatch.push({
        id: `eer-${dept.code.toLowerCase()}-${ay.replace('/', '')}`, ...audit,
        examinerId: ctx.ids.examinerIds[Math.floor(rng.next() * ctx.ids.examinerIds.length)]?.id ?? 'extexam-001',
        academicYearId: ayId,
        reportDate: `${2000 + parseInt(ay.split('/')[1], 10)}-07-01T00:00:00Z`,
        content: `External examiner endorsement of standards in ${dept.name}.`,
        recommendations: 'Continue current practice.',
        institutionResponse: 'Recommendations accepted.',
      });
    }
  }
  ctx.append('ExamBoard', ebBatch);
  ctx.append('ExternalExaminerReport', eeRepBatch);
  ctx.log(domain, `${ebBatch.length} exam boards`);

  // 3. Submissions + Marks + Attempts (streamed in batches)
  //    Pre-build programme→deptId index so we can find the exam board fast.
  const progIdByDeptByAy = new Map();   // programmeId → deptId
  for (const p of ctx.ids.programmeIds) progIdByDeptByAy.set(p.id, p.departmentId);

  let subSeq = 0, modSeq = 0, sm2Seq = 0, tsSeq = 0, plagSeq = 0;
  let ecSeq = 0, mcSeq = 0, reasSeq = 0, mdSeq = 0;
  let subBatch = [], markBatch = [], attemptBatch = [];
  let modBatch = [], modDecBatch = [], smBatch = [], tsBatch = [];
  let plagBatch = [], ecBatch = [], mcBatch = [], reasBatch = [], mdBatch = [];

  for (const en of ctx.ids.enrolmentIds) {
    if (en.status !== 'COMPLETED' && en.status !== 'ACTIVE') continue;
    const candidates = assessmentsByAyId.get(en.ayId) ?? [];
    if (!candidates.length) continue;
    const numToTake = Math.min(2, candidates.length);
    // Pick deterministic-by-position (no shuffle to keep perf high)
    const startIdx = (subSeq * 7) % candidates.length;
    for (let i = 0; i < numToTake; i++) {
      const a = candidates[(startIdx + i) % candidates.length];
      subSeq += 1;
      const sid = `sub-${subSeq.toString().padStart(8, '0')}`;
      const mid = `mark-${subSeq.toString().padStart(8, '0')}`;
      const submittedAt = `2025-12-${String(1 + (subSeq % 28)).padStart(2, '0')}T12:00:00Z`;
      subBatch.push({
        id: sid, ...audit,
        assessmentId: a.id, studentId: en.studentId, enrolmentId: en.id,
        submittedAt, submissionStatus: 'SUBMITTED',
        fileUrl: `minio://documents/submissions/${sid}.pdf`,
        fileSize: 200_000, wordCount: 2000,
        anonymousCode: `ANON-${subSeq % 1_000_000}`,
        isLate: rng.chance(0.05), daysLate: 0,
      });
      const mv = Math.max(0, Math.min(100, Math.round(rng.gauss(MARK_DISTRIBUTION_MEAN, MARK_DISTRIBUTION_STDDEV))));
      markBatch.push({
        id: mid, ...audit, submissionId: sid, value: mv, grade: classFor(mv),
        markerName: 'Module Leader', markerEmail: 'module.leader@fhe.ac.uk',
        markedAt: now, isReleased: en.status === 'COMPLETED',
        releasedAt: en.status === 'COMPLETED' ? now : null,
        comments: null, isModerated: false,
      });
      attemptBatch.push({
        id: `att-${subSeq.toString().padStart(8, '0')}`,
        createdAt: now, updatedAt: now,
        submissionId: sid, attemptNumber: 1, attemptType: 'FIRST_SIT',
        markValue: mv, gradeOutcome: classFor(mv), cappedAt: null, isLatest: true,
      });

      if (rng.chance(0.1)) {
        modSeq += 1;
        modBatch.push({
          id: `mod-${modSeq}`, ...audit,
          markId: mid, moderatorName: 'Moderator',
          moderatorEmail: 'moderator@fhe.ac.uk',
          moderationDate: now, moderatedMark: mv,
          originalMark: mv + rng.int(-3, 3),
          rationale: 'Sample moderation; marks confirmed.', actionTaken: 'NO_CHANGE',
        });
        modDecBatch.push({
          id: `mdv2-${modSeq}`, createdAt: now, updatedAt: now,
          submissionId: sid, decisionType: 'CONFIRM',
          decisionDate: now, decidedBy: 'moderator@fhe.ac.uk',
          rationale: 'Confirmed by sample moderation.',
        });
      }
      if (rng.chance(0.03)) {
        sm2Seq += 1;
        smBatch.push({
          id: `sm-${sm2Seq}`, ...audit, submissionId: sid,
          secondMarkerName: 'Second Marker', secondMarkerEmail: 'second.marker@fhe.ac.uk',
          secondMark: mv + rng.int(-5, 5), markedAt: now, agreedMark: mv,
        });
      }
      if (rng.chance(0.3)) {
        tsSeq += 1;
        tsBatch.push({
          id: `ts-${tsSeq}`, createdAt: now, updatedAt: now,
          submissionId: sid, turnitinId: `TI${tsSeq}`,
          similarityPercentage: rng.int(2, 25),
          submittedToTurnitin: now,
          reportUrl: `https://turnitin.com/reports/${tsSeq}`,
        });
        if (rng.chance(0.015)) {
          plagSeq += 1;
          plagBatch.push({
            id: `plag-${plagSeq}`, ...audit,
            submissionId: sid, studentId: en.studentId,
            similarityScore: rng.int(40, 80),
            referredTo: 'Academic Misconduct Panel',
            outcome: 'MINOR', penaltyApplied: 'Mark reduced; resubmit capped at 40',
            decidedAt: now,
          });
        }
      }
      if (rng.chance(0.07)) {
        ecSeq += 1;
        ecBatch.push({
          id: `ec-${ecSeq}`, ...audit,
          submissionId: sid, ecType: 'ILLNESS', outcomeType: 'EXTENSION',
          appliedAt: now, evidenceUrl: null,
        });
        if (rng.chance(0.5)) {
          mcSeq += 1;
          mcBatch.push({
            id: `mc-${mcSeq}`, ...audit,
            studentId: en.studentId, submissionId: sid,
            circumstanceType: 'HEALTH', reportedDate: now,
            decision: 'ACCEPTED', decisionDate: now, supportingDocsUrl: null,
          });
        }
      }
      if (mv < 40 && rng.chance(0.5)) {
        reasSeq += 1;
        reasBatch.push({
          id: `reas-${reasSeq}`, ...audit,
          submissionId: sid, attemptNumber: 2, attemptType: 'RESIT',
          originalMark: mv, reassessmentMark: 40 + rng.int(0, 25),
          cappedMark: 40, completedAt: now,
        });
      }

      if (subBatch.length >= BATCH) {
        flushBatch(ctx, 'AssessmentSubmission', subBatch);
        flushBatch(ctx, 'Mark', markBatch);
        flushBatch(ctx, 'AssessmentAttempt', attemptBatch);
        flushBatch(ctx, 'ModerationRecord', modBatch);
        flushBatch(ctx, 'ModerationDecisionV2', modDecBatch);
        flushBatch(ctx, 'SecondMarkingRecord', smBatch);
        flushBatch(ctx, 'TurnitinSubmission', tsBatch);
        flushBatch(ctx, 'PlagiarismCase', plagBatch);
        flushBatch(ctx, 'ECOutcome', ecBatch);
        flushBatch(ctx, 'MitigatingCircumstance', mcBatch);
        flushBatch(ctx, 'ReassessmentRecord', reasBatch);
      }
    }
    if (subSeq % 100_000 < numToTake) ctx.log(domain, `... ${subSeq.toLocaleString()} submissions`);
  }
  flushBatch(ctx, 'AssessmentSubmission', subBatch);
  flushBatch(ctx, 'Mark', markBatch);
  flushBatch(ctx, 'AssessmentAttempt', attemptBatch);
  flushBatch(ctx, 'ModerationRecord', modBatch);
  flushBatch(ctx, 'ModerationDecisionV2', modDecBatch);
  flushBatch(ctx, 'SecondMarkingRecord', smBatch);
  flushBatch(ctx, 'TurnitinSubmission', tsBatch);
  flushBatch(ctx, 'PlagiarismCase', plagBatch);
  flushBatch(ctx, 'ECOutcome', ecBatch);
  flushBatch(ctx, 'MitigatingCircumstance', mcBatch);
  flushBatch(ctx, 'ReassessmentRecord', reasBatch);
  ctx.log(domain, `${subSeq.toLocaleString()} submissions written`);

  // 4. ExamBoardDecision + ProgressionRecord per enrolment
  let edSeq = 0;
  let ebdBatch = [], prBatch = [], boBatch = [], rrBatch = [], caBatch = [];
  for (const en of ctx.ids.enrolmentIds) {
    edSeq += 1;
    const deptId = progIdByDeptByAy.get(en.programmeId);
    const ay = ctx.ids.academicYears.find(a => a.id === en.ayId)?.label ?? '2025/26';
    const ebId = examBoardIdByDeptAy.get(`${deptId}|${ay}`) ?? `eb-unknown`;
    ebdBatch.push({
      id: `ebd-${edSeq.toString().padStart(8, '0')}`, ...audit,
      examBoardId: ebId, studentId: en.studentId, enrolmentId: en.id,
      decisionType: 'PROGRESSION',
      decision: en.status === 'COMPLETED' ? 'PROGRESS' : 'PROVISIONAL_PROGRESS',
      rationale: null, decidedAt: now,
    });
    if (en.status === 'COMPLETED') {
      prBatch.push({
        id: `progr-${edSeq.toString().padStart(8, '0')}`, ...audit,
        studentId: en.studentId, enrolmentId: en.id,
        academicYearId: en.ayId,
        decision: 'PROGRESS_TO_NEXT_YEAR',
        creditsEarned: 120, creditsRequired: 120,
        weightedAverage: Math.round(rng.gauss(58, 10)),
        progressionDate: now, isCompensated: false,
      });
    }
    if (edSeq <= 5000) {
      boBatch.push({
        id: `bo-${edSeq.toString().padStart(5, '0')}`,
        createdAt: now, updatedAt: now,
        examBoardId: ebId, decisionCount: 25,
        agreedCount: 24, deferredCount: 1, releasedAt: now,
      });
      rrBatch.push({
        id: `rr-${edSeq.toString().padStart(5, '0')}`,
        createdAt: now, updatedAt: now,
        studentId: en.studentId, enrolmentId: en.id,
        releaseDate: now, releaseChannel: 'PORTAL', confirmedByStudent: true,
      });
      caBatch.push({
        id: `ca-${edSeq.toString().padStart(5, '0')}`,
        createdAt: now, updatedAt: now,
        enrolmentId: en.id, calculationType: 'YEAR_AVERAGE',
        inputJson: '{}', outputJson: '{"average":60}', calculatedAt: now,
      });
    }
    if (ebdBatch.length >= BATCH) {
      flushBatch(ctx, 'ExamBoardDecision', ebdBatch);
      flushBatch(ctx, 'ProgressionRecord', prBatch);
      flushBatch(ctx, 'BoardOutcome', boBatch);
      flushBatch(ctx, 'ResultRelease', rrBatch);
      flushBatch(ctx, 'CalculationAudit', caBatch);
    }
  }
  flushBatch(ctx, 'ExamBoardDecision', ebdBatch);
  flushBatch(ctx, 'ProgressionRecord', prBatch);
  flushBatch(ctx, 'BoardOutcome', boBatch);
  flushBatch(ctx, 'ResultRelease', rrBatch);
  flushBatch(ctx, 'CalculationAudit', caBatch);

  // 5. Tail samples
  const tailNow = audit;
  const deferralRows = [];
  for (let i = 0; i < 4_000 && i * 20 < ctx.ids.enrolmentIds.length; i++) {
    const en = ctx.ids.enrolmentIds[i * 20];
    deferralRows.push({
      id: `def-${i.toString().padStart(4, '0')}`, ...tailNow,
      enrolmentId: en.id, deferralType: 'EXAM',
      deferralReason: 'EC accepted',
      deferralStartDate: now, deferralEndDate: now,
      isApproved: true, approvedBy: ctx.seedActor,
    });
  }
  ctx.append('DeferralRecord', deferralRows);

  const appealRows = [];
  for (let i = 0; i < 4_000 && i * 20 < ctx.ids.enrolmentIds.length; i++) {
    const en = ctx.ids.enrolmentIds[i * 20];
    appealRows.push({
      id: `appeal-${i.toString().padStart(4, '0')}`, ...tailNow,
      studentId: en.studentId, enrolmentId: en.id,
      appealType: rng.pick(['MARK_REVIEW', 'PROGRESSION', 'AWARD', 'PROCEDURAL']),
      grounds: 'Procedural irregularity',
      submittedDate: now, decisionDate: now,
      decision: rng.weighted([['UPHELD', 20], ['REJECTED', 60], ['PARTIAL', 20]]),
      decidedBy: ctx.seedActor,
    });
  }
  ctx.append('AppealRecord', appealRows);

  const condRows = [];
  for (let i = 0; i < 5_000 && i * 20 < ctx.ids.enrolmentIds.length; i++) {
    const en = ctx.ids.enrolmentIds[i * 20];
    condRows.push({
      id: `cond-${i.toString().padStart(4, '0')}`, createdAt: now, updatedAt: now,
      studentId: en.studentId, enrolmentId: en.id,
      moduleId: ctx.ids.moduleIds[i % ctx.ids.moduleIds.length]?.id ?? 'unknown',
      condonedMark: 35, condonedReason: 'COMPENSATION_RULE',
      condonedAt: now, condonedBy: ctx.seedActor,
    });
  }
  ctx.append('CondonementRecord', condRows);

  const modSampleRows = [];
  for (let i = 0; i < 25_000; i++) {
    modSampleRows.push({
      id: `ms-${i.toString().padStart(5, '0')}`, ...tailNow,
      assessmentId: ctx.ids.assessmentIds[i % ctx.ids.assessmentIds.length]?.id ?? 'unknown',
      sampleSize: 15, sampledAt: now,
      moderatorName: 'Sample Moderator', outcome: 'CONFIRMED',
      findings: 'Marks within expected distribution',
    });
  }
  ctx.append('ModerationSampleRecord', modSampleRows);

  const erdRows = [];
  for (let i = 0; i < 5_000; i++) {
    erdRows.push({
      id: `erd-${i.toString().padStart(4, '0')}`,
      createdAt: now, updatedAt: now,
      examinerId: ctx.ids.examinerIds[i % ctx.ids.examinerIds.length]?.id ?? 'extexam-001',
      assessmentId: ctx.ids.assessmentIds[i * 3 % ctx.ids.assessmentIds.length]?.id ?? 'unknown',
      reviewDate: now, decision: 'AGREE', notes: 'Concur with marking.',
    });
  }
  ctx.append('ExternalReviewDecision', erdRows);

  const markerRows = [];
  for (let i = 0; i < Math.min(50_000, subSeq); i++) {
    markerRows.push({
      id: `md-${i.toString().padStart(6, '0')}`,
      createdAt: now, updatedAt: now,
      markId: `mark-${(i + 1).toString().padStart(8, '0')}`,
      markerName: 'Marker', decision: 'CONFIRM', decisionAt: now,
    });
  }
  ctx.append('MarkerDecision', markerRows);

  // 6. Attendance (lightweight) + engagement + retention — streamed per-enrolment
  let attBatch = [], absBatch = [], engBatch = [], engAlertBatch = [];
  let engIntBatch = [], retBatch = [], retIntBatch = [], retHistBatch = [];
  let attSessSeq = 0;
  const attSessBatch = [];
  // Sample attendance sessions for 1000 modules
  for (const m of ctx.ids.moduleIds.slice(0, 1000)) {
    for (const ay of targetAYs) {
      attSessBatch.push({
        id: `attsess-${m.code.toLowerCase()}-${ay.replace('/', '')}`, ...tailNow,
        moduleId: m.id, academicYearId: ctx.ids.academicYearIdByLabel.get(ay),
        sessionDate: '2025-10-15T10:00:00Z',
        sessionType: 'LECTURE', durationMinutes: 50,
        expectedAttendees: 60, actualAttendees: rng.int(35, 58),
      });
      attSessSeq += 1;
      if (attSessBatch.length >= BATCH) flushBatch(ctx, 'AttendanceSession', attSessBatch);
    }
  }
  flushBatch(ctx, 'AttendanceSession', attSessBatch);

  for (const en of ctx.ids.enrolmentIds) {
    const attPct = Math.max(0, Math.min(100, Math.round(rng.gauss(78, 12))));
    attBatch.push({
      id: `attrec-${en.id.slice(3)}`, ...tailNow,
      studentId: en.studentId, enrolmentId: en.id, academicYearId: en.ayId,
      sessionsExpected: 120, sessionsAttended: Math.round(120 * attPct / 100),
      attendancePercentage: attPct, lastUpdated: now,
    });
    if (attPct < 70) {
      absBatch.push({
        id: `abs-${en.id.slice(3)}`, ...tailNow,
        studentId: en.studentId, enrolmentId: en.id,
        absenceDate: '2025-11-01T00:00:00Z', durationDays: rng.int(1, 14),
        reasonCode: rng.pick(['ILLNESS', 'PERSONAL', 'UNKNOWN']),
        reasonDetail: null, isAuthorised: rng.chance(0.7), reportedAt: now,
      });
    }
    const engScore = Math.max(0, Math.min(100, Math.round(rng.gauss(72, 15))));
    engBatch.push({
      id: `engsc-${en.id.slice(3)}`, ...tailNow,
      studentId: en.studentId, enrolmentId: en.id, academicYearId: en.ayId,
      engagementScore: engScore,
      assessmentContribution: 0.4, attendanceContribution: 0.3, vleContribution: 0.3,
      calculatedAt: now,
    });
    if (engScore < 50) {
      engAlertBatch.push({
        id: `enga-${en.id.slice(3)}`, ...tailNow,
        studentId: en.studentId, enrolmentId: en.id,
        alertType: 'LOW_ENGAGEMENT', alertLevel: 'AMBER',
        triggeredAt: now, triggeredBy: 'engagement_calculator',
        notifiedTo: 'personal.tutor@fhe.ac.uk',
        isAcknowledged: rng.chance(0.7),
      });
      if (rng.chance(0.3)) {
        engIntBatch.push({
          id: `engi-${en.id.slice(3)}`, ...tailNow,
          studentId: en.studentId, enrolmentId: en.id,
          interventionType: 'PERSONAL_TUTOR_MEETING',
          plannedDate: now, completedDate: now,
          outcome: 'STUDENT_ENGAGED', notes: 'Initial outreach',
          deliveredBy: 'personal.tutor@fhe.ac.uk',
        });
      }
    }
    const riskScore = Math.max(0, Math.min(100, Math.round(rng.gauss(28, 18))));
    retBatch.push({
      id: `rrs-${en.id.slice(3)}`, ...tailNow,
      studentId: en.studentId, enrolmentId: en.id, academicYearId: en.ayId,
      riskScore, riskBand: riskScore > 60 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW',
      calculatedAt: now, modelVersion: 'v1.0', features: null,
    });
    if (riskScore > 60) {
      retIntBatch.push({
        id: `ri-${en.id.slice(3)}`, ...tailNow,
        studentId: en.studentId, enrolmentId: en.id,
        interventionType: 'WELLBEING_REFERRAL',
        plannedDate: now, completedDate: now,
        outcome: 'STUDENT_ENGAGED', notes: null,
      });
    }
    if (rng.chance(0.7)) {
      retHistBatch.push({
        id: `rhs-${en.id.slice(3)}`,
        createdAt: now, updatedAt: now,
        studentId: en.studentId, snapshotDate: now,
        riskScore: riskScore + rng.int(-10, 10),
        riskBand: riskScore > 60 ? 'HIGH' : 'LOW',
        modelVersion: 'v0.9',
      });
    }
    if (attBatch.length >= BATCH) {
      flushBatch(ctx, 'AttendanceRecord', attBatch);
      flushBatch(ctx, 'AbsenceRecord', absBatch);
      flushBatch(ctx, 'EngagementScore', engBatch);
      flushBatch(ctx, 'EngagementAlert', engAlertBatch);
      flushBatch(ctx, 'EngagementIntervention', engIntBatch);
      flushBatch(ctx, 'RetentionRiskScore', retBatch);
      flushBatch(ctx, 'RetentionIntervention', retIntBatch);
      flushBatch(ctx, 'RetentionHistoricalScore', retHistBatch);
    }
  }
  flushBatch(ctx, 'AttendanceRecord', attBatch);
  flushBatch(ctx, 'AbsenceRecord', absBatch);
  flushBatch(ctx, 'EngagementScore', engBatch);
  flushBatch(ctx, 'EngagementAlert', engAlertBatch);
  flushBatch(ctx, 'EngagementIntervention', engIntBatch);
  flushBatch(ctx, 'RetentionRiskScore', retBatch);
  flushBatch(ctx, 'RetentionIntervention', retIntBatch);
  flushBatch(ctx, 'RetentionHistoricalScore', retHistBatch);

  // 7. NeedsAssessment + ExamAdjustment for disability-declared students
  const disabledStudents = ctx.ids.studentIds.filter(s => s.disability && s.disability !== 'NONE');
  const naRows = [], eaRows = [];
  for (const stu of disabledStudents.slice(0, 3000)) {
    naRows.push({
      id: `na-${stu.id.slice(4)}`, ...tailNow,
      studentId: stu.id, assessmentDate: '2025-10-01T00:00:00Z',
      assessor: 'Disability Services',
      identifiedNeeds: 'Extra time + scribe',
      reasonableAdjustments: '25% extra time on exams; assistive technology',
      reviewDate: '2026-10-01T00:00:00Z', isActive: true,
    });
    eaRows.push({
      id: `ea-${stu.id.slice(4)}`, ...tailNow,
      studentId: stu.id, adjustmentType: 'EXTRA_TIME',
      percentageExtra: 25, useOfReader: false, useOfScribe: false,
      separateRoom: true, restBreaks: false,
      assistiveTech: 'Speech-to-text software', approvedBy: 'Disability Services',
      validFrom: '2024-09-01T00:00:00Z', validTo: null,
    });
  }
  ctx.append('NeedsAssessment', naRows);
  ctx.append('ExamAdjustment', eaRows);

  ctx.log(domain,
    `${ctx.ids.assessmentIds.length.toLocaleString()} assessments, ${subSeq.toLocaleString()} submissions, ${modSeq.toLocaleString()} moderation, ${edSeq.toLocaleString()} board decisions, ${disabledStudents.length} disability adjustments`);
}
