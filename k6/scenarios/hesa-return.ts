import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const hesaValidationDuration = new Trend('hesa_validation_duration');
const hesaGenerationDuration = new Trend('hesa_generation_duration');
const hesaDashboardDuration = new Trend('hesa_dashboard_duration');
const hesaOdataQueryDuration = new Trend('hesa_odata_query_duration');
const backgroundOperationDuration = new Trend('background_operation_duration');
const validationErrors = new Rate('hesa_validation_errors');
const reportsGenerated = new Counter('hesa_reports_generated');

export const options = {
  ...baseOptions,
  stages: [
    // Ramp: 0 → 550 users over 2 minutes (50 compliance staff + 500 background)
    { duration: '2m', target: 550 },
    // Sustain peak: 550 users for 15 minutes (HESA return generation)
    { duration: '15m', target: 550 },
    // Ramp down: 550 → 0 over 5 minutes
    { duration: '5m', target: 0 },
  ],
};

/**
 * HESA Return Load Test
 * Simulates HESA return generation under realistic load:
 * - 50 concurrent compliance staff running quality checks & generating returns
 * - 500 concurrent background users (students/staff) doing normal operations
 * Focus: measure validation time, return generation time, OData query performance
 */
export default function hesaReturn() {
  // Determine user type
  const isComplianceStaff = __VU <= 50;

  if (isComplianceStaff) {
    complianceStaffFlow();
  } else {
    backgroundUserFlow();
  }
}

function complianceStaffFlow() {
  const token = getAuthToken('admin');
  const headers = getHeaders(token);

  group('Compliance Staff Login', () => {
    http.post(`${BASE_URL}/auth/login`, JSON.stringify({}), {
      headers,
      tags: { name: 'ComplianceLogin' },
    });
  });

  sleep(2);

  // Run quality checks
  for (let i = 0; i < 3; i++) {
    group(`Quality Check Run ${i + 1}`, () => {
      const startTime = Date.now();

      const checkRes = http.post(
        `${BASE_URL}/compliance/hesa/quality-check`,
        JSON.stringify({ batchSize: 1000 }),
        { headers, tags: { name: 'HesaQualityCheck', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      hesaValidationDuration.add(duration);

      check(checkRes, {
        'quality check status is 200': (r) => r.status === 200,
        'check has results': (r) => r.body.includes('passed') || r.body.includes('errors'),
      });

      if (
        checkRes.status !== 200 ||
        checkRes.body.includes('error') ||
        checkRes.body.includes('failed')
      ) {
        validationErrors.add(1);
      }
    });

    sleep(5);

    // Generate return after quality check passes
    group(`Generate HESA Return ${i + 1}`, () => {
      const startTime = Date.now();

      const returnPayload = {
        academicYear: '2023/24',
        submissionPeriod: 'Final',
        dataCollection: 'StudentILD',
      };

      const generateRes = http.post(
        `${BASE_URL}/compliance/hesa/generate-return`,
        JSON.stringify(returnPayload),
        { headers, tags: { name: 'HesaGenerate', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      hesaGenerationDuration.add(duration);

      check(generateRes, {
        'generation status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'return generated': (r) =>
          r.body.includes('returnId') ||
          r.body.includes('generated') ||
          r.body.includes('success'),
      });

      if (generateRes.status === 200 || generateRes.status === 201) {
        reportsGenerated.add(1);
      }
    });

    sleep(5);

    // View compliance dashboard
    group(`View Compliance Dashboard ${i + 1}`, () => {
      const startTime = Date.now();

      const dashRes = http.get(`${BASE_URL}/compliance/hesa/dashboard`, {
        headers,
        tags: { name: 'HesaDashboard', staticAsset: 'no' },
      });

      const duration = Date.now() - startTime;
      hesaDashboardDuration.add(duration);

      check(dashRes, {
        'dashboard status is 200': (r) => r.status === 200,
        'dashboard has metrics': (r) =>
          r.body.includes('count') || r.body.includes('submissions'),
      });
    });

    sleep(5);

    // Run OData query for detailed analytics
    group(`OData Query Batch ${i + 1}`, () => {
      const startTime = Date.now();

      const odataRes = http.get(
        `${BASE_URL}/odata/StudentILD?$select=StudentID,ModuleID,AssessmentMark&$filter=AssessmentMark gt 40&$top=5000`,
        { headers, tags: { name: 'HesaODataQuery', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      hesaOdataQueryDuration.add(duration);

      check(odataRes, {
        'odata status is 200': (r) => r.status === 200,
        'odata has results': (r) => r.body.includes('value') || r.body.includes('Student'),
      });
    });

    sleep(5);
  }

  group('Compliance Staff Logout', () => {
    http.post(`${BASE_URL}/auth/logout`, JSON.stringify({}), {
      headers,
      tags: { name: 'ComplianceLogout' },
    });
  });
}

function backgroundUserFlow() {
  // Simulate normal student/staff operations in background during HESA return generation
  const role = Math.random() > 0.7 ? 'staff' : 'student';
  const token = getAuthToken(role);
  const headers = getHeaders(token);

  group(`Background ${role} Operation`, () => {
    const startTime = Date.now();

    // Random endpoint access
    const endpoints = [
      '/students/dashboard',
      '/students/grades',
      '/students/attendance',
      '/staff/modules',
      '/staff/attendance/register',
      '/modules/MOD-001',
    ];

    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

    const res = http.get(`${BASE_URL}${randomEndpoint}`, {
      headers,
      tags: { name: 'BackgroundOperation', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    backgroundOperationDuration.add(duration);

    check(res, {
      'background operation status ok': (r) => r.status < 400,
    });
  });

  sleep(Math.random() * 30 + 10);
}
