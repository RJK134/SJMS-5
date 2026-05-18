/**
 * identity generator (D2)
 *
 * Foundation rows: tenant configuration, system configuration, role catalogue,
 * permission catalogue, role-permission mappings, ~10 system Users for the
 * leadership team (VC, Registrar, IT lead, etc.). The Person + ContactMethod
 * + PersonAddress + ConsentRecord chain is populated incrementally by every
 * downstream generator (staff, students, applicants) via ctx.append() and
 * flushed once at the end of the run.
 *
 * Models that stay empty in D2 (populated by later phases):
 *   Person, PersonName, ContactMethod, PersonAddress, AddressUsage,
 *   PersonNationality, Citizenship, ResidencyStatus, EmergencyContact,
 *   IdentityDocument, SensitiveAttribute, ConsentRecord, LawfulBasisRecord,
 *   Session, ApiKey, AuditLog, EncryptionKeyMetadata, PolicyAssignment,
 *   ProcessingPurpose, QueryOptimizationHint
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { INSTITUTION } from '../lib/uk-uni-skeleton.mjs';

export const domain = 'identity';

const SYSTEM_USERS = [
  { username: 'vc',        firstName: 'Margaret',  lastName: 'Hollingsworth', role: 'VICE_CHANCELLOR',         email: 'vc@fhe.ac.uk' },
  { username: 'pvc.educ',  firstName: 'Daniel',    lastName: 'Okafor',        role: 'PVC_EDUCATION',           email: 'pvc.education@fhe.ac.uk' },
  { username: 'pvc.res',   firstName: 'Sarah',     lastName: 'Whitfield',     role: 'PVC_RESEARCH',            email: 'pvc.research@fhe.ac.uk' },
  { username: 'coo',       firstName: 'Imran',     lastName: 'Mahmood',       role: 'CHIEF_OPERATING_OFFICER', email: 'coo@fhe.ac.uk' },
  { username: 'cfo',       firstName: 'Eleanor',   lastName: 'Chen',          role: 'CHIEF_FINANCIAL_OFFICER', email: 'cfo@fhe.ac.uk' },
  { username: 'registrar', firstName: 'James',     lastName: 'Patterson',     role: 'REGISTRAR',               email: 'registrar@fhe.ac.uk' },
  { username: 'it.head',   firstName: 'Priya',     lastName: 'Sharma',        role: 'HEAD_OF_IT',              email: 'it.head@fhe.ac.uk' },
  { username: 'hr.head',   firstName: 'Marcus',    lastName: 'Bennett',       role: 'HEAD_OF_HR',              email: 'hr.head@fhe.ac.uk' },
  { username: 'admissions',firstName: 'Catherine', lastName: 'Walsh',         role: 'HEAD_OF_ADMISSIONS',      email: 'admissions@fhe.ac.uk' },
  { username: 'student.exp',firstName: 'Olawale',  lastName: 'Adesanya',      role: 'HEAD_OF_STUDENT_EXPERIENCE', email: 'student.experience@fhe.ac.uk' },
  { username: 'sysadmin',  firstName: 'System',    lastName: 'Administrator', role: 'SYSTEM_ADMIN',            email: 'sysadmin@fhe.ac.uk' },
];

const ROLES = [
  { name: 'VICE_CHANCELLOR',         displayName: 'Vice-Chancellor',       sortOrder: 1 },
  { name: 'PVC_EDUCATION',           displayName: 'PVC Education',         sortOrder: 2 },
  { name: 'PVC_RESEARCH',            displayName: 'PVC Research',          sortOrder: 3 },
  { name: 'CHIEF_OPERATING_OFFICER', displayName: 'Chief Operating Officer', sortOrder: 4 },
  { name: 'CHIEF_FINANCIAL_OFFICER', displayName: 'Chief Financial Officer', sortOrder: 5 },
  { name: 'REGISTRAR',               displayName: 'Registrar',             sortOrder: 6 },
  { name: 'HEAD_OF_IT',              displayName: 'Head of IT',            sortOrder: 7 },
  { name: 'HEAD_OF_HR',              displayName: 'Head of HR',            sortOrder: 8 },
  { name: 'HEAD_OF_ADMISSIONS',      displayName: 'Head of Admissions',    sortOrder: 9 },
  { name: 'HEAD_OF_STUDENT_EXPERIENCE', displayName: 'Head of Student Experience', sortOrder: 10 },
  { name: 'SYSTEM_ADMIN',            displayName: 'System Administrator',  sortOrder: 11 },
  { name: 'DEAN',                    displayName: 'Dean',                  sortOrder: 20 },
  { name: 'HEAD_OF_DEPARTMENT',      displayName: 'Head of Department',    sortOrder: 21 },
  { name: 'PROFESSOR',               displayName: 'Professor',             sortOrder: 30 },
  { name: 'SENIOR_LECTURER',         displayName: 'Senior Lecturer',       sortOrder: 31 },
  { name: 'LECTURER',                displayName: 'Lecturer',              sortOrder: 32 },
  { name: 'TEACHING_FELLOW',         displayName: 'Teaching Fellow',       sortOrder: 33 },
  { name: 'RESEARCH_FELLOW',         displayName: 'Research Fellow',       sortOrder: 34 },
  { name: 'PROFESSIONAL_SERVICES',   displayName: 'Professional Services Staff', sortOrder: 40 },
  { name: 'EXTERNAL_EXAMINER',       displayName: 'External Examiner',     sortOrder: 50 },
  { name: 'STAFF',                   displayName: 'Generic Staff',         sortOrder: 60 },
  { name: 'STUDENT',                 displayName: 'Student',               sortOrder: 70 },
  { name: 'APPLICANT',               displayName: 'Applicant',             sortOrder: 71 },
  { name: 'ALUMNUS',                 displayName: 'Alumnus',               sortOrder: 72 },
];

// Resource × Action permission catalogue — covers the major SJMS-5 mutations.
const PERMISSIONS = [
  // students
  ['students',   'read',   'View student records'],
  ['students',   'create', 'Create student records'],
  ['students',   'update', 'Update student records'],
  ['students',   'delete', 'Soft-delete student records'],
  // applications
  ['applications', 'read',   'View applications'],
  ['applications', 'create', 'Create applications'],
  ['applications', 'update', 'Update applications'],
  ['applications', 'decide', 'Issue admissions decisions'],
  // enrolments
  ['enrolments', 'read',   'View enrolments'],
  ['enrolments', 'create', 'Create enrolments'],
  ['enrolments', 'update', 'Update enrolments'],
  ['enrolments', 'withdraw', 'Withdraw enrolments'],
  // assessments
  ['assessments', 'read',   'View assessments'],
  ['assessments', 'create', 'Create assessments'],
  ['assessments', 'mark',   'Enter marks'],
  ['assessments', 'moderate', 'Moderate marks'],
  ['assessments', 'release', 'Release marks to students'],
  // exam boards
  ['exam-boards', 'attend', 'Attend exam boards'],
  ['exam-boards', 'decide', 'Issue exam-board decisions'],
  // finance
  ['fees',        'read',   'View fee assessments'],
  ['fees',        'assess', 'Run fee assessments'],
  ['fees',        'waive',  'Waive fees'],
  ['invoices',    'read',   'View invoices'],
  ['invoices',    'issue',  'Issue invoices'],
  ['invoices',    'void',   'Void invoices'],
  ['payments',    'read',   'View payments'],
  ['payments',    'record', 'Record payments'],
  ['payments',    'refund', 'Issue refunds'],
  ['bursaries',   'award',  'Award bursaries'],
  ['sponsors',    'manage', 'Manage sponsor relationships'],
  // staff
  ['staff',       'read',   'View staff records'],
  ['staff',       'update', 'Update staff records'],
  ['contracts',   'manage', 'Manage staff contracts'],
  // governance
  ['committees',  'read',   'View committee data'],
  ['committees',  'manage', 'Manage committee membership and meetings'],
  // HESA / regulatory
  ['hesa-returns','generate','Generate HESA returns'],
  ['hesa-returns','submit', 'Submit HESA returns'],
  ['ofs-reports', 'view',   'View OfS reports'],
  // platform
  ['tenants',     'manage', 'Manage tenant configuration'],
  ['users',       'manage', 'Manage user accounts'],
  ['roles',       'manage', 'Manage role assignments'],
  ['system-config','manage','Manage system configuration'],
  ['audit-log',   'view',   'View audit log'],
  // research
  ['research-outputs', 'manage', 'Manage research outputs (REF)'],
  ['ref-submissions',  'submit', 'Submit REF returns'],
];

// Coarse role → permission grants. Each role gets the union of its grants.
const ROLE_PERMISSIONS = {
  SYSTEM_ADMIN: ['*'],
  VICE_CHANCELLOR: ['*'],
  REGISTRAR: ['students:*', 'enrolments:*', 'applications:*', 'assessments:read', 'hesa-returns:*', 'audit-log:view'],
  HEAD_OF_ADMISSIONS: ['applications:*'],
  HEAD_OF_IT: ['system-config:manage', 'users:manage', 'roles:manage', 'audit-log:view'],
  HEAD_OF_HR: ['staff:*', 'contracts:manage'],
  CHIEF_FINANCIAL_OFFICER: ['fees:*', 'invoices:*', 'payments:*', 'bursaries:award', 'sponsors:manage'],
  PVC_EDUCATION: ['students:read', 'enrolments:read', 'assessments:*', 'exam-boards:*', 'committees:*'],
  PVC_RESEARCH: ['research-outputs:*', 'ref-submissions:*', 'committees:read'],
  CHIEF_OPERATING_OFFICER: ['staff:*', 'committees:*', 'audit-log:view'],
  HEAD_OF_STUDENT_EXPERIENCE: ['students:read', 'committees:read'],
  DEAN: ['committees:read', 'staff:read', 'enrolments:read'],
  HEAD_OF_DEPARTMENT: ['staff:read', 'enrolments:read', 'assessments:read'],
  PROFESSOR: ['assessments:mark', 'assessments:moderate', 'exam-boards:attend', 'enrolments:read'],
  SENIOR_LECTURER: ['assessments:mark', 'assessments:moderate', 'enrolments:read'],
  LECTURER: ['assessments:mark', 'enrolments:read'],
  TEACHING_FELLOW: ['assessments:mark', 'enrolments:read'],
  RESEARCH_FELLOW: ['research-outputs:manage'],
  PROFESSIONAL_SERVICES: ['students:read'],
  EXTERNAL_EXAMINER: ['exam-boards:attend', 'assessments:read'],
  STAFF: ['enrolments:read'],
  STUDENT: [],
  APPLICANT: [],
  ALUMNUS: [],
};

function permissionCode(resource, action) {
  return `${resource}:${action}`;
}

function passwordHashFor(username) {
  // Deterministic placeholder — generator never emits real credentials.
  return `$argon2id$v=19$m=65536,t=3,p=4$generator$placeholder-${username}`;
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();

  // 1. Tenant configuration (single row — multi-tenancy is Phase 2 of SJMS-5)
  ctx.append('TenantConfiguration', [{
    id: `tcfg-${ctx.tenantId}`,
    ...ctx.audit(now),
    tenantId: ctx.tenantId,
    institutionName: INSTITUTION.name,
    institutionCode: INSTITUTION.shortName,
    ukprn: INSTITUTION.ukprn,
    country: 'UK',
    timezone: 'Europe/London',
    academicYearStart: 9,
    academicYearEnd: 8,
  }]);

  // 2. System configuration
  ctx.append('SystemConfiguration', [
    ['datalake.snapshot.path', 'gdrive5tb:sjms-5-dataset/latest/', 'STRING', 'Lake snapshot folder', false],
    ['hesa.submission.threshold.attempts', '3', 'INTEGER', 'Max validation attempts before manual review', false],
    ['fee.deferred.tolerance.days', '30', 'INTEGER', 'Days before deferred fee triggers escalation', false],
    ['email.sender.default', 'noreply@fhe.ac.uk', 'STRING', 'Default sender for system emails', false],
    ['portal.session.timeout.minutes', '60', 'INTEGER', 'User session timeout', false],
    ['retention.audit.years', '7', 'INTEGER', 'AuditLog retention (HESA / data-protection requirement)', false],
  ].map(([key, value, type, desc, enc], i) => ({
    id: `syscfg-${i.toString().padStart(3, '0')}`,
    ...ctx.audit(now),
    configKey: key, configValue: value, configType: type,
    description: desc, isEncrypted: enc,
  })));

  // 3. Role catalogue
  const roleIdByName = new Map();
  ctx.append('Role', ROLES.map((r) => {
    const id = `role-${r.name.toLowerCase().replace(/_/g, '-')}`;
    roleIdByName.set(r.name, id);
    return {
      id, ...ctx.audit(now),
      name: r.name, displayName: r.displayName,
      description: r.displayName, isActive: true, sortOrder: r.sortOrder,
    };
  }));

  // 4. Permission catalogue
  const permissionIdByCode = new Map();
  ctx.append('Permission', PERMISSIONS.map(([resource, action, displayName]) => {
    const code = permissionCode(resource, action);
    const id = `perm-${code.replace(/[:.]/g, '-')}`;
    permissionIdByCode.set(code, id);
    return {
      id, ...ctx.audit(now),
      code, resource, action, displayName, description: displayName,
    };
  }));

  // 5. Role → permission mappings
  const rolePerms = [];
  for (const [roleName, grants] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIdByName.get(roleName);
    if (!roleId) continue;
    const granted = new Set();
    for (const grant of grants) {
      if (grant === '*') {
        for (const code of permissionIdByCode.keys()) granted.add(code);
      } else if (grant.endsWith(':*')) {
        const resource = grant.slice(0, -2);
        for (const code of permissionIdByCode.keys()) {
          if (code.startsWith(resource + ':')) granted.add(code);
        }
      } else {
        granted.add(grant);
      }
    }
    for (const code of granted) {
      const permId = permissionIdByCode.get(code);
      if (!permId) continue;
      rolePerms.push({
        id: `rp-${roleId}-${permId}`,
        ...ctx.audit(now),
        roleId, permissionId: permId,
      });
    }
  }
  ctx.append('RolePermission', rolePerms);

  // 6. System users (~11) + their UserRole assignments
  const users = [];
  const userRoles = [];
  for (const u of SYSTEM_USERS) {
    const id = `user-${u.username}`;
    users.push({
      id, ...ctx.audit(now),
      username: u.username, email: u.email,
      passwordHash: passwordHashFor(u.username),
      firstName: u.firstName, lastName: u.lastName,
      isActive: true, lastLoginAt: now, loginAttempts: 0, lockedUntil: null,
      tenantId: ctx.tenantId,
    });
    const roleId = roleIdByName.get(u.role);
    if (roleId) {
      userRoles.push({
        id: `ur-${id}-${roleId}`,
        ...ctx.audit(now),
        userId: id, roleId, role: u.role, scope: 'institution', scopeId: ctx.tenantId,
      });
    }
    ctx.ids.personIds.push(id); // reuse user id as person-like reference for system accounts
  }
  ctx.append('User', users);
  ctx.append('UserRole', userRoles);

  ctx.log(domain, `${ROLES.length} roles, ${PERMISSIONS.length} permissions, ${rolePerms.length} role-permission grants, ${users.length} system users`);
}
