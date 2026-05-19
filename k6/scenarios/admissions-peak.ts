import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const admissionsLoginDuration = new Trend('admissions_login_duration');
const applicantSearchDuration = new Trend('applicant_search_duration');
const applicationViewDuration = new Trend('application_view_duration');
const decisionDuration = new Trend('admissions_decision_duration');
const applicantDecisionCheckDuration = new Trend('applicant_decision_check_duration');
const applicantOfferAcceptanceDuration = new Trend('applicant_offer_acceptance_duration');
const ucasResultsDayErrors = new Rate('ucas_results_day_errors');
const decisionsRecorded = new Counter('decisions_recorded');

export const options = {
  ...baseOptions,
  stages: [
    // UCAS Results Day spike: 0 → 1000 concurrent users in 30 seconds
    { duration: '30s', target: 1000 },
    // Hold at peak: 1000 users for 15 minutes
    { duration: '15m', target: 1000 },
    // Ramp down: 1000 → 0 over 2 minutes
    { duration: '2m', target: 0 },
  ],
};

/**
 * Admissions Peak Load Test — UCAS Results Day
 * Simulates 1,000 concurrent admissions officers + applicants on UCAS results day
 * Split: 600 applicants checking decisions, 400 admissions staff making decisions
 */
export default function admissionsPeak() {
  // Determine user type based on VU iteration
  const isApplicant = __VU % 2 === 0;
  const role = isApplicant ? 'student' : 'admissions';
  const token = getAuthToken(role);
  const headers = getHeaders(token);

  if (isApplicant) {
    // Applicant flow
    applicantFlow(headers, token);
  } else {
    // Admissions officer flow
    admissionsOfficerFlow(headers, token);
  }
}

function applicantFlow(headers: { [key: string]: string }, token: string) {
  group('Applicant Login', () => {
    const startTime = Date.now();
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({}), {
      headers,
      tags: { name: 'ApplicantLogin' },
    });

    const duration = Date.now() - startTime;
    admissionsLoginDuration.add(duration);

    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login successful': (r) => r.body.includes('token') || r.cookies.session?.length > 0,
    });
  });

  sleep(2);

  group('Check Application Decision', () => {
    const startTime = Date.now();
    const decisionRes = http.get(`${BASE_URL}/applicants/decision`, {
      headers,
      tags: { name: 'ApplicantCheckDecision', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    applicantDecisionCheckDuration.add(duration);

    check(decisionRes, {
      'decision status is 200': (r) => r.status === 200,
      'decision data present': (r) =>
        r.body.includes('decision') || r.body.includes('offer') || r.body.includes('status'),
    });
  });

  sleep(3);

  group('Accept Offer', () => {
    const startTime = Date.now();
    const acceptRes = http.post(
      `${BASE_URL}/applicants/decision/accept`,
      JSON.stringify({ acceptOffer: true }),
      { headers, tags: { name: 'ApplicantAcceptOffer', staticAsset: 'no' } }
    );

    const duration = Date.now() - startTime;
    applicantOfferAcceptanceDuration.add(duration);

    check(acceptRes, {
      'accept status is 200': (r) => r.status === 200,
      'acceptance confirmed': (r) => r.body.includes('accepted') || r.body.includes('success'),
    });
  });

  sleep(2);

  group('Begin Enrolment', () => {
    const enrolmentRes = http.post(
      `${BASE_URL}/applicants/enrolment/initiate`,
      JSON.stringify({}),
      { headers, tags: { name: 'ApplicantBeginEnrolment' } }
    );

    check(enrolmentRes, {
      'enrolment initiated': (r) => r.status === 200 || r.status === 201,
    });
  });

  sleep(1);

  group('Applicant Logout', () => {
    http.post(`${BASE_URL}/auth/logout`, JSON.stringify({}), {
      headers,
      tags: { name: 'ApplicantLogout' },
    });
  });
}

function admissionsOfficerFlow(headers: { [key: string]: string }, token: string) {
  group('Admissions Officer Login', () => {
    const startTime = Date.now();
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({}), {
      headers,
      tags: { name: 'AdmissionsLogin' },
    });

    const duration = Date.now() - startTime;
    admissionsLoginDuration.add(duration);

    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login successful': (r) => r.body.includes('token'),
    });
  });

  sleep(2);

  // Process multiple applications in this session
  for (let i = 0; i < 5; i++) {
    group(`Search Applications (Batch ${i + 1})`, () => {
      const startTime = Date.now();
      const searchRes = http.get(
        `${BASE_URL}/admissions/applications?status=pending&limit=10&offset=${i * 10}`,
        { headers, tags: { name: 'AdmissionsSearch', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      applicantSearchDuration.add(duration);

      check(searchRes, {
        'search status is 200': (r) => r.status === 200,
        'search has applications': (r) => r.body.includes('application'),
      });
    });

    sleep(3);

    group(`View Application (Batch ${i + 1})`, () => {
      const startTime = Date.now();
      const appId = `APP-${String(i + 1).padStart(6, '0')}`;

      const viewRes = http.get(`${BASE_URL}/admissions/applications/${appId}`, {
        headers,
        tags: { name: 'AdmissionsViewApp', staticAsset: 'no' },
      });

      const duration = Date.now() - startTime;
      applicationViewDuration.add(duration);

      check(viewRes, {
        'view status is 200': (r) => r.status === 200,
        'view has application details': (r) => r.body.includes('student') || r.body.includes('grades'),
      });
    });

    sleep(4);

    group(`Make Decision (Batch ${i + 1})`, () => {
      const startTime = Date.now();
      const appId = `APP-${String(i + 1).padStart(6, '0')}`;

      const decisionPayload = {
        decision: Math.random() > 0.2 ? 'offer' : 'reject', // 80% offers, 20% rejections
        conditions: Math.random() > 0.5 ? 'Standard entry' : 'Conditional offer',
        notes: 'Reviewed at UCAS results day',
      };

      const decisionRes = http.post(
        `${BASE_URL}/admissions/applications/${appId}/decision`,
        JSON.stringify(decisionPayload),
        { headers, tags: { name: 'AdmissionsMakeDecision', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      decisionDuration.add(duration);

      check(decisionRes, {
        'decision status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'decision recorded': (r) => r.body.includes('success') || r.body.includes('decision'),
      });

      if (decisionRes.status === 200 || decisionRes.status === 201) {
        decisionsRecorded.add(1);
      } else {
        ucasResultsDayErrors.add(1);
      }
    });

    sleep(3);
  }

  group('Admissions Officer Logout', () => {
    http.post(`${BASE_URL}/auth/logout`, JSON.stringify({}), {
      headers,
      tags: { name: 'AdmissionsLogout' },
    });
  });
}
