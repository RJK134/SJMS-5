import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const enrolmentInitiateDuration = new Trend('enrolment_initiate_duration');
const enrolmentStageDuration = new Trend('enrolment_stage_duration');
const enrolmentCompleteDuration = new Trend('enrolment_complete_duration');
const stageDropoffRate = new Rate('enrolment_stage_dropoff');
const stagesCompleted = new Counter('enrolment_stages_completed');

export const options = {
  ...baseOptions,
  stages: [
    // Rapid ramp: 0 → 1500 users over 3 minutes (September rush)
    { duration: '3m', target: 1500 },
    // Sustain: 1500 users for 20 minutes (whole enrolment period)
    { duration: '20m', target: 1500 },
    // Ramp down: 1500 → 0 over 5 minutes
    { duration: '5m', target: 0 },
  ],
};

const ENROLMENT_STAGES = 12; // Number of stages in enrolment workflow
const STAGE_DROPOFF_RATE = 0.30; // 30% drop off at each stage (realistic)

/**
 * Enrolment Period Load Test
 * Simulates September enrolment rush with 1,500 concurrent students
 * Each student goes through 12-stage enrolment workflow
 * 30% of students drop off at each stage (realistic)
 */
export default function enrolmentPeriod() {
  const token = getAuthToken('student');
  const headers = getHeaders(token);

  // Think time: 10-30 seconds (form filling)
  const thinkTime = () => sleep(Math.random() * 20 + 10);

  // Initiate enrolment
  group('Initiate Enrolment', () => {
    const startTime = Date.now();

    const initiateRes = http.post(`${BASE_URL}/enrolment/initiate`, JSON.stringify({}), {
      headers,
      tags: { name: 'EnrolmentInitiate', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    enrolmentInitiateDuration.add(duration);

    check(initiateRes, {
      'initiate status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'enrolment session created': (r) => r.body.includes('enrolmentId') || r.body.includes('session'),
    });
  });

  thinkTime();

  // Complete each of the 12 stages
  for (let stage = 1; stage <= ENROLMENT_STAGES; stage++) {
    // Check if this user drops off at this stage
    if (Math.random() < STAGE_DROPOFF_RATE) {
      stageDropoffRate.add(1);
      break; // Student drops off
    }

    group(`Complete Stage ${stage} of ${ENROLMENT_STAGES}`, () => {
      const startTime = Date.now();

      // Different payloads based on stage
      const payload = getStagePayload(stage);

      const stageRes = http.post(
        `${BASE_URL}/enrolment/stage/${stage}`,
        JSON.stringify(payload),
        {
          headers,
          tags: { name: `EnrolmentStage${stage}`, staticAsset: 'no' },
        }
      );

      const duration = Date.now() - startTime;
      enrolmentStageDuration.add(duration);

      check(stageRes, {
        'stage status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'stage submitted': (r) => r.body.includes('success') || r.body.includes('submitted'),
      });

      if (stageRes.status === 200 || stageRes.status === 201) {
        stagesCompleted.add(1);
      }
    });

    thinkTime();
  }

  // Complete enrolment
  group('Complete Enrolment', () => {
    const startTime = Date.now();

    const completeRes = http.post(`${BASE_URL}/enrolment/complete`, JSON.stringify({}), {
      headers,
      tags: { name: 'EnrolmentComplete', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    enrolmentCompleteDuration.add(duration);

    check(completeRes, {
      'complete status is 200': (r) => r.status === 200,
      'enrolment confirmed': (r) =>
        r.body.includes('enrolled') || r.body.includes('confirmed'),
    });
  });
}

/**
 * Generate stage-specific payload based on enrolment workflow stage
 */
function getStagePayload(stage: number): Record<string, any> {
  switch (stage) {
    case 1:
      return {
        stageId: 'verify-identity',
        studentNumber: `SN${String(Math.random() * 1000000).padStart(7, '0')}`,
        dob: '2004-05-15',
      };

    case 2:
      return {
        stageId: 'programme-selection',
        programmeCode: 'BSC-COMP-SCIENCE',
        mode: 'full-time',
        startDate: '2024-09-01',
      };

    case 3:
      return {
        stageId: 'financial-info',
        fundingType: Math.random() > 0.5 ? 'student-loan' : 'self-funded',
        expectedIncome: Math.random() > 0.5,
      };

    case 4:
      return {
        stageId: 'accommodation',
        requiresAccommodation: Math.random() > 0.4,
        accommodationPref: 'university-halls',
      };

    case 5:
      return {
        stageId: 'emergency-contact',
        emergencyContact: 'Parent',
        emergencyPhone: '07700000000',
      };

    case 6:
      return {
        stageId: 'disability-disclosure',
        hasDisability: Math.random() > 0.9,
        disabilityType: 'dyslexia',
      };

    case 7:
      return {
        stageId: 'module-selection',
        modules: [
          { code: 'CS101', name: 'Introduction to Programming' },
          { code: 'CS102', name: 'Data Structures' },
          { code: 'CS103', name: 'Web Development' },
        ],
      };

    case 8:
      return {
        stageId: 'course-delivery',
        preferredDelivery: Math.random() > 0.3 ? 'blended' : 'in-person',
        timetablePreferences: { morning: true, afternoon: true, evening: false },
      };

    case 9:
      return {
        stageId: 'terms-and-conditions',
        acceptsTerms: true,
        acceptsPrivacy: true,
        acceptsCode: true,
      };

    case 10:
      return {
        stageId: 'student-activities',
        unionMember: Math.random() > 0.2,
        sportsClubs: ['Football', 'Tennis'],
        societies: ['Debate Society', 'Tech Club'],
      };

    case 11:
      return {
        stageId: 'payment-setup',
        paymentMethod: Math.random() > 0.7 ? 'installments' : 'full',
        bankDetails: { accountHolder: 'Student Name', sortCode: '12-34-56' },
      };

    case 12:
      return {
        stageId: 'final-confirmation',
        confirmationCode: `CONF${String(Math.random() * 1000000).padStart(6, '0')}`,
        ready: true,
      };

    default:
      return { stageId: `stage-${stage}` };
  }
}
