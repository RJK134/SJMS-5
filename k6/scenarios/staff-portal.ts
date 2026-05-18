import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { getAuthToken, getHeaders, BASE_URL, baseOptions } from '../config.js';

// Custom metrics
const staffLoginDuration = new Trend('staff_login_duration');
const staffModulesDuration = new Trend('staff_modules_duration');
const staffMarksEntryDuration = new Trend('staff_marks_entry_duration');
const staffAttendanceDuration = new Trend('staff_attendance_duration');
const staffTuteesDuration = new Trend('staff_tutees_duration');
const staffLogoutErrors = new Rate('staff_logout_errors');

export const options = {
  ...baseOptions,
  stages: [
    // Ramp: 0 → 100 users over 2 minutes
    { duration: '2m', target: 100 },
    // Hold: 100 users for 5 minutes
    { duration: '5m', target: 100 },
    // Ramp: 100 → 500 users over 5 minutes
    { duration: '5m', target: 500 },
    // Hold: 500 users for 10 minutes
    { duration: '10m', target: 500 },
    // Ramp down: 500 → 0 over 5 minutes
    { duration: '5m', target: 0 },
  ],
};

/**
 * Staff Portal Load Test
 * Simulates 500 concurrent academic staff entering marks and managing attendance
 */
export default function staffPortal() {
  const token = getAuthToken('staff');
  const headers = getHeaders(token);

  // Think time between 5-15 seconds for staff (more complex interactions)
  const thinkTime = () => sleep(Math.random() * 10 + 5);

  group('Staff Login', () => {
    const startTime = Date.now();
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({}), {
      headers,
      tags: { name: 'StaffLogin' },
    });

    const duration = Date.now() - startTime;
    staffLoginDuration.add(duration);

    check(loginRes, {
      'login status is 200': (r) => r.status === 200,
      'login has session': (r) => r.cookies.session?.length > 0 || r.body.includes('token'),
    });
  });

  thinkTime();

  group('View Assigned Modules', () => {
    const startTime = Date.now();
    const modulesRes = http.get(`${BASE_URL}/staff/modules`, {
      headers,
      tags: { name: 'StaffModules', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    staffModulesDuration.add(duration);

    check(modulesRes, {
      'modules status is 200': (r) => r.status === 200,
      'modules has data': (r) => r.body.includes('module') || r.body.includes('code'),
    });
  });

  thinkTime();

  group('Enter Marks for Module (Batch of 30)', () => {
    const startTime = Date.now();

    // Get a module to enter marks for
    const moduleRes = http.get(`${BASE_URL}/staff/modules`, {
      headers,
      tags: { name: 'StaffGetModule' },
    });

    if (moduleRes.status === 200) {
      const moduleId = 'MOD-TEST-001'; // Simulated module ID

      // Enter marks for batch of 30 students
      const marksPayload = Array.from({ length: 30 }, (_, i) => ({
        studentId: `STUDENT-${String(i + 1).padStart(5, '0')}`,
        mark: Math.floor(Math.random() * 100),
        feedback: `Assessment feedback for student ${i + 1}`,
      }));

      const marksRes = http.post(
        `${BASE_URL}/staff/modules/${moduleId}/marks/batch`,
        JSON.stringify({ marks: marksPayload }),
        { headers, tags: { name: 'StaffMarksEntry', staticAsset: 'no' } }
      );

      const duration = Date.now() - startTime;
      staffMarksEntryDuration.add(duration);

      check(marksRes, {
        'marks submission status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'marks submission successful': (r) =>
          r.body.includes('success') || r.body.includes('submitted'),
      });
    }
  });

  thinkTime();

  group('View Attendance Register', () => {
    const startTime = Date.now();
    const registerRes = http.get(`${BASE_URL}/staff/attendance/register`, {
      headers,
      tags: { name: 'StaffAttendanceRegister', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    staffAttendanceDuration.add(duration);

    check(registerRes, {
      'register status is 200': (r) => r.status === 200,
      'register has attendance data': (r) => r.body.includes('attendance') || r.body.includes('present'),
    });
  });

  thinkTime();

  group('Record Attendance', () => {
    const moduleId = 'MOD-TEST-001';
    const sessionId = 'SESSION-001';

    // Record attendance for 30 students
    const attendancePayload = Array.from({ length: 30 }, (_, i) => ({
      studentId: `STUDENT-${String(i + 1).padStart(5, '0')}`,
      status: Math.random() > 0.1 ? 'present' : 'absent', // 90% present
      timestamp: new Date().toISOString(),
    }));

    const attendanceRes = http.post(
      `${BASE_URL}/staff/attendance/${moduleId}/${sessionId}/record`,
      JSON.stringify({ attendance: attendancePayload }),
      { headers, tags: { name: 'StaffRecordAttendance', staticAsset: 'no' } }
    );

    check(attendanceRes, {
      'attendance record status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'attendance recorded': (r) =>
        r.body.includes('success') || r.body.includes('recorded'),
    });
  });

  thinkTime();

  group('View Tutees', () => {
    const startTime = Date.now();
    const tuteesRes = http.get(`${BASE_URL}/staff/tutees`, {
      headers,
      tags: { name: 'StaffTutees', staticAsset: 'no' },
    });

    const duration = Date.now() - startTime;
    staffTuteesDuration.add(duration);

    check(tuteesRes, {
      'tutees status is 200': (r) => r.status === 200,
      'tutees has data': (r) => r.body.includes('student') || r.body.includes('tutor'),
    });
  });

  thinkTime();

  group('Logout', () => {
    const logoutRes = http.post(`${BASE_URL}/auth/logout`, JSON.stringify({}), {
      headers,
      tags: { name: 'StaffLogout' },
    });

    check(logoutRes, {
      'logout status is 200': (r) => r.status === 200,
    });

    if (logoutRes.status !== 200) {
      staffLogoutErrors.add(1);
    }
  });
}
