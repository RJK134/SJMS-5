import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const getStudentRecordDuration = new Trend('api_get_student_record_duration');
const getModuleDataDuration = new Trend('api_get_module_data_duration');
const postAttendanceDuration = new Trend('api_post_attendance_duration');
const getFinanceDuration = new Trend('api_get_finance_duration');
const getComplianceDashDuration = new Trend('api_get_compliance_dash_duration');
const postMarksDuration = new Trend('api_post_marks_duration');
const apiErrors = new Rate('api_stress_errors');
const apiRequests = new Counter('api_stress_requests');

export const options = {
  ...baseOptions,
  stages: [
    // Ramp: 0 → 1000 users over 2 minutes
    { duration: '2m', target: 1000 },
    // Ramp: 1000 → 3000 users over 3 minutes
    { duration: '3m', target: 3000 },
    // Ramp: 3000 → 5000 users over 5 minutes
    { duration: '5m', target: 5000 },
    // Hold: 5000 users for 10 minutes
    { duration: '10m', target: 5000 },
    // Ramp down: 5000 → 0 over 5 minutes
    { duration: '5m', target: 0 },
  ],
};

/**
 * API Stress Test
 * 5,000 concurrent users hitting mixed endpoints with no think time
 * Endpoint distribution:
 * - 40% GET /students/{id}
 * - 20% GET /modules/{id}
 * - 15% POST /attendance
 * - 10% GET /finance/{id}
 * - 10% GET /compliance/dashboard
 * - 5% POST /marks
 */
export default function apiStress() {
  const token = getAuthToken('admin');
  const headers = getHeaders(token);

  const random = Math.random() * 100;

  if (random < 40) {
    // 40% GET student records
    getStudentRecord(headers);
  } else if (random < 60) {
    // 20% GET module data
    getModuleData(headers);
  } else if (random < 75) {
    // 15% POST attendance
    postAttendance(headers);
  } else if (random < 85) {
    // 10% GET finance
    getFinanceData(headers);
  } else if (random < 95) {
    // 10% GET compliance dashboard
    getComplianceDashboard(headers);
  } else {
    // 5% POST marks
    postMarks(headers);
  }
}

function getStudentRecord(headers: { [key: string]: string }) {
  group('GET /students/{id}', () => {
    const studentId = `STUDENT-${String(Math.floor(Math.random() * 50000) + 1).padStart(6, '0')}`;
    const startTime = Date.now();

    const res = http.get(`${BASE_URL}/students/${studentId}`, {
      headers,
      tags: { name: 'GetStudentRecord', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    getStudentRecordDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}

function getModuleData(headers: { [key: string]: string }) {
  group('GET /modules/{id}', () => {
    const moduleId = `MOD-${String(Math.floor(Math.random() * 5000) + 1).padStart(5, '0')}`;
    const startTime = Date.now();

    const res = http.get(`${BASE_URL}/modules/${moduleId}`, {
      headers,
      tags: { name: 'GetModuleData', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    getModuleDataDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}

function postAttendance(headers: { [key: string]: string }) {
  group('POST /attendance', () => {
    const startTime = Date.now();

    const payload = {
      moduleId: `MOD-${String(Math.floor(Math.random() * 5000) + 1).padStart(5, '0')}`,
      sessionId: `SESSION-${String(Math.floor(Math.random() * 100000) + 1).padStart(6, '0')}`,
      studentId: `STUDENT-${String(Math.floor(Math.random() * 50000) + 1).padStart(6, '0')}`,
      status: Math.random() > 0.1 ? 'present' : 'absent',
      timestamp: new Date().toISOString(),
    };

    const res = http.post(`${BASE_URL}/attendance`, JSON.stringify(payload), {
      headers,
      tags: { name: 'PostAttendance', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    postAttendanceDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}

function getFinanceData(headers: { [key: string]: string }) {
  group('GET /finance/{id}', () => {
    const studentId = `STUDENT-${String(Math.floor(Math.random() * 50000) + 1).padStart(6, '0')}`;
    const startTime = Date.now();

    const res = http.get(`${BASE_URL}/finance/${studentId}`, {
      headers,
      tags: { name: 'GetFinance', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    getFinanceDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}

function getComplianceDashboard(headers: { [key: string]: string }) {
  group('GET /compliance/dashboard', () => {
    const startTime = Date.now();

    const res = http.get(`${BASE_URL}/compliance/dashboard`, {
      headers,
      tags: { name: 'GetComplianceDash', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    getComplianceDashDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200': (r) => r.status === 200,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}

function postMarks(headers: { [key: string]: string }) {
  group('POST /marks', () => {
    const startTime = Date.now();

    const payload = {
      moduleId: `MOD-${String(Math.floor(Math.random() * 5000) + 1).padStart(5, '0')}`,
      studentId: `STUDENT-${String(Math.floor(Math.random() * 50000) + 1).padStart(6, '0')}`,
      mark: Math.floor(Math.random() * 100),
      feedback: 'Assessment feedback',
    };

    const res = http.post(`${BASE_URL}/marks`, JSON.stringify(payload), {
      headers,
      tags: { name: 'PostMarks', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    postMarksDuration.add(duration);
    apiRequests.add(1);

    check(res, {
      'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    if (res.status >= 400) {
      apiErrors.add(1);
    }
  });
}
