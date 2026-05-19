import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const studentLoginDuration = new Trend('student_login_duration');
const studentDashboardDuration = new Trend('student_dashboard_duration');
const studentEnrolmentCheckDuration = new Trend('student_enrolment_check_duration');
const studentTimetableDuration = new Trend('student_timetable_duration');
const studentAttendanceDuration = new Trend('student_attendance_duration');
const studentGradesDuration = new Trend('student_grades_duration');
const studentFinanceDuration = new Trend('student_finance_duration');
const studentLogoutErrors = new Rate('student_logout_errors');

export const options = {
  ...baseOptions,
  stages: [
    // Ramp: 0 → 500 users over 2 minutes
    { duration: '2m', target: 500 },
    // Hold: 500 users for 5 minutes
    { duration: '5m', target: 500 },
    // Ramp: 500 → 2000 users over 5 minutes
    { duration: '5m', target: 2000 },
    // Hold: 2000 users for 10 minutes
    { duration: '10m', target: 2000 },
    // Ramp down: 2000 → 0 over 5 minutes
    { duration: '5m', target: 0 },
  ],
};

/**
 * Student Portal Load Test
 * Simulates 2,000 concurrent students accessing the SJMS portal
 */
export default function studentPortal() {
  const token = getAuthToken('student');
  const headers = getHeaders(token);

  // Think time between 3-8 seconds
  const thinkTime = () => sleep(Math.random() * 5 + 3);

  group('Student Login', () => {
    const startTime = Date.now();
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({}), {
      headers,
      tags: { name: 'StudentLogin' },
    });

    const duration = Date.now() - startTime;
    studentLoginDuration.add(duration);

    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login has session': (r) => r.cookies.session?.length > 0 || r.body.includes('token'),
    });
  });

  thinkTime();

  group('View Dashboard', () => {
    const startTime = Date.now();
    const dashRes = http.get(`${BASE_URL}/students/dashboard`, {
      headers,
      tags: { name: 'StudentDashboard', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentDashboardDuration.add(duration);

    check(dashRes, {
      'dashboard status is 200': (r) => r.status === 200,
      'dashboard has user data': (r) => r.body.includes('student') || r.body.includes('dashboard'),
    });
  });

  thinkTime();

  group('Check Enrolment Status', () => {
    const startTime = Date.now();
    const enrolRes = http.get(`${BASE_URL}/students/enrolment/status`, {
      headers,
      tags: { name: 'StudentEnrolment', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentEnrolmentCheckDuration.add(duration);

    check(enrolRes, {
      'enrolment status is 200': (r) => r.status === 200,
      'enrolment has status': (r) =>
        r.body.includes('status') || r.body.includes('enrolled') || r.body.includes('pending'),
    });
  });

  thinkTime();

  group('View Timetable', () => {
    const startTime = Date.now();
    const timetableRes = http.get(`${BASE_URL}/students/timetable`, {
      headers,
      tags: { name: 'StudentTimetable', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentTimetableDuration.add(duration);

    check(timetableRes, {
      'timetable status is 200': (r) => r.status === 200,
      'timetable has sessions': (r) => r.body.includes('session') || r.body.includes('time'),
    });
  });

  thinkTime();

  group('Check Attendance', () => {
    const startTime = Date.now();
    const attendanceRes = http.get(`${BASE_URL}/students/attendance`, {
      headers,
      tags: { name: 'StudentAttendance', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentAttendanceDuration.add(duration);

    check(attendanceRes, {
      'attendance status is 200': (r) => r.status === 200,
      'attendance has data': (r) => r.body.includes('attendance') || r.body.includes('percent'),
    });
  });

  thinkTime();

  group('View Grades', () => {
    const startTime = Date.now();
    const gradesRes = http.get(`${BASE_URL}/students/grades`, {
      headers,
      tags: { name: 'StudentGrades', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentGradesDuration.add(duration);

    check(gradesRes, {
      'grades status is 200': (r) => r.status === 200,
      'grades has marks': (r) => r.body.includes('grade') || r.body.includes('mark'),
    });
  });

  thinkTime();

  group('View Finance Balance', () => {
    const startTime = Date.now();
    const financeRes = http.get(`${BASE_URL}/students/finance/balance`, {
      headers,
      tags: { name: 'StudentFinance', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    studentFinanceDuration.add(duration);

    check(financeRes, {
      'finance status is 200': (r) => r.status === 200,
      'finance has balance': (r) =>
        r.body.includes('balance') || r.body.includes('outstanding') || r.body.includes('paid'),
    });
  });

  thinkTime();

  group('Logout', () => {
    const logoutRes = http.post(`${BASE_URL}/auth/logout`, JSON.stringify({}), {
      headers,
      tags: { name: 'StudentLogout' },
    });

    check(logoutRes, {
      'logout status is 200': (r) => r.status === 200,
    });

    if (logoutRes.status !== 200) {
      studentLogoutErrors.add(1);
    }
  });
}
