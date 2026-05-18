/**
 * staff generator (D3)
 *
 * 1,000 active staff at AY 2025/26, plus ~200 leavers over the 5-year window
 * → 1,200 staff records. Distribution:
 *   - 5 senior leadership: VC/PVCs/COO/CFO (already in identity.mjs — skipped)
 *   - 6 Deans (one per faculty)
 *   - 48 Heads of Department (one per dept)
 *   - 540 academic staff (Professor/Senior Lecturer/Lecturer/Teaching Fellow)
 *     spread across 48 departments
 *   - 350 professional services (admin, library, IT, estates, etc.)
 *   - 50 external examiners (peer-institution academics)
 *
 * Each staff member is a Person with PersonName, ContactMethod (work email +
 * phone), PersonAddress (home address), Nationality, ConsentRecord (×4),
 * LawfulBasisRecord (×4). The Person family is filled via lib/person-factory.
 *
 * Each Staff has 1–3 StaffContract rows (renewals, FTE changes) over their
 * tenure. Plus ~1.5 StaffQualification per academic staff (undergraduate +
 * PhD, plus PGCHE for newer lecturers).
 *
 * ExternalExaminer (50 from peer institutions) — distinct from internal Staff;
 * no Person record (external to the org). ExternalExaminerAppointment links
 * them to Programmes (FK populated in D4 after programmes exist; the
 * appointment rows live here but with placeholder programmeIds — D4 will
 * back-fill if needed, though the importer accepts text FKs at import time).
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ALL_DEPARTMENTS, INSTITUTION, FACULTIES } from '../lib/uk-uni-skeleton.mjs';
import {
  FIRST_NAMES, LAST_NAMES,
  GENDERS_WEIGHTED, ETHNICITY_WEIGHTED, DISABILITY_WEIGHTED,
  STAFF_GRADE_BANDS, CONTRACT_TYPES_WEIGHTED, ACADEMIC_FUNCTIONS_WEIGHTED,
  FTE_PART_TIME_VALUES, POSTCODE_AREAS,
} from '../lib/uk-demographics.mjs';
import { createPerson } from '../lib/person-factory.mjs';

export const domain = 'staff';

// Distribution of staff roles within each department.
const ACADEMIC_PER_DEPT = 12;
const PROF_SERVICES_TOTAL = 350;
const EXTERNAL_EXAMINERS = 50;

const ACADEMIC_TITLES = ['Prof.', 'Dr.', 'Dr.', 'Mr', 'Mrs', 'Ms', 'Mx'];
const PS_TITLES = ['Mr', 'Mrs', 'Ms', 'Mx'];

const ACADEMIC_JOB_TITLES = [
  ['Professor',           9],
  ['Reader',              8],
  ['Senior Lecturer',     7],
  ['Lecturer',            6],
  ['Teaching Fellow',     5],
  ['Research Fellow',     6],
];

const PS_JOB_TITLES = [
  ['Faculty Operations Manager',    7],
  ['Senior Administrative Officer', 6],
  ['Administrative Officer',        4],
  ['Student Records Officer',       5],
  ['Library Manager',               6],
  ['Library Assistant',             3],
  ['IT Technician',                 4],
  ['Senior IT Officer',             6],
  ['HR Business Partner',           6],
  ['Finance Officer',               5],
  ['Marketing Officer',             5],
  ['Communications Manager',        6],
  ['Estates Officer',               4],
  ['Health & Safety Officer',       5],
  ['Compliance Officer',            6],
];

const PEER_INSTITUTIONS = [
  'University of Manchester', 'University of Leeds', 'University of Sheffield',
  'University of Liverpool', 'University of Nottingham', 'University of Birmingham',
  'University of Bristol', 'University of Cardiff', 'University of Edinburgh',
  'University of Glasgow', 'University of Strathclyde', 'University of Bath',
  'University of Surrey', 'University of Reading', 'Open University',
  'Oxford Brookes University', 'Northumbria University', 'Loughborough University',
  'University of York', 'Lancaster University',
];

const SUBJECTS_PER_DEPT = (deptName) => deptName;

function pickName(rng) {
  return { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES) };
}

function genderToHesaSex(g) {
  return ({ MALE: '1', FEMALE: '2', OTHER: '3', PREFER_NOT_TO_SAY: '4' })[g] ?? '4';
}

function fakeAddress(rng, idx) {
  const num = (idx % 500) + 1;
  const street = rng.pick(['High Street', 'Park Road', 'Church Lane', 'Mill Lane', 'Manor Drive',
    'Queens Road', 'Kings Avenue', 'Victoria Street', 'Albert Road', 'Garden Lane']);
  const area = rng.pick(POSTCODE_AREAS);
  const postcode = `${area}${rng.int(1, 9)} ${rng.int(1, 9)}${rng.pick(['AA','AB','AE','AF','BX','CD'])}`;
  return {
    line1: `${num} ${street}`,
    line2: null,
    line3: null,
    city: rng.pick(['Manchester','Leeds','Sheffield','Birmingham','Bristol','Liverpool',
      'Nottingham','Cardiff','Edinburgh','Glasgow','Newcastle','Belfast',
      'Reading','Cambridge','Oxford','Brighton','York','Norwich','Plymouth',
      'Stoke-on-Trent','Coventry','Hull','Derby','Leicester','Wolverhampton']),
    county: null,
    postcode, country: 'United Kingdom', countryCode: 'GB',
  };
}

function staffEmail(first, last, suffix, used) {
  const clean = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  let email = `${clean(first)}.${clean(last)}${suffix}@${INSTITUTION.domain}`;
  let n = 1;
  while (used.has(email)) {
    email = `${clean(first)}.${clean(last)}${n}${suffix}@${INSTITUTION.domain}`;
    n++;
  }
  used.add(email);
  return email;
}

function dobForAge(rng, minAge, maxAge, asOfYear = 2025) {
  const age = rng.int(minAge, maxAge);
  const dob = new Date(Date.UTC(asOfYear - age, rng.int(0, 11), rng.int(1, 28)));
  return dob.toISOString().slice(0, 10);
}

function salaryForGrade(rng, grade) {
  const band = STAFF_GRADE_BANDS.find((b) => b.grade === grade)
    ?? STAFF_GRADE_BANDS.find((b) => b.grade === 6);
  return rng.int(band.minSalary, band.maxSalary);
}

function contractTypeForRole(jobTitle, rng) {
  if (jobTitle === 'Teaching Fellow' || jobTitle === 'Research Fellow') {
    return rng.weighted([['FIXED_TERM', 70], ['PERMANENT', 30]]);
  }
  return rng.weighted(CONTRACT_TYPES_WEIGHTED);
}

function fteFor(rng, contractType) {
  if (contractType === 'ATYPICAL' || contractType === 'HOURLY_PAID') return rng.pick(FTE_PART_TIME_VALUES);
  return rng.weighted([[1.0, 80], [0.8, 8], [0.6, 5], [0.5, 4], [0.4, 3]]);
}

function deptIdFor(ctx, deptCode) {
  return ctx.ids.departmentByCode.get(deptCode).id;
}

function hesaContractLevelFor(jobTitle) {
  const map = { 'Professor': 'C1', 'Reader': 'C0', 'Senior Lecturer': 'B2',
    'Lecturer': 'B1', 'Teaching Fellow': 'B0', 'Research Fellow': 'B0' };
  return map[jobTitle] ?? 'A1';
}

function socCodeFor(jobTitle) {
  const map = {
    'Professor': '2311', 'Reader': '2311', 'Senior Lecturer': '2311',
    'Lecturer': '2311', 'Teaching Fellow': '2311', 'Research Fellow': '2311',
    'Faculty Operations Manager': '1184', 'Senior Administrative Officer': '4151',
    'Administrative Officer': '4151', 'Student Records Officer': '4151',
    'Library Manager': '1184', 'Library Assistant': '4151',
    'IT Technician': '2133', 'Senior IT Officer': '2133',
    'HR Business Partner': '2425', 'Finance Officer': '2421',
    'Marketing Officer': '1132', 'Communications Manager': '1132',
    'Estates Officer': '4151', 'Health & Safety Officer': '2461',
    'Compliance Officer': '2461',
  };
  return map[jobTitle] ?? '4151';
}

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const rng = ctx.rng.fork('staff');
  const usedEmails = new Set();
  let staffSeq = 0;

  const staffRows = [];
  const recordRows = [];
  const contractRows = [];
  const qualRows = [];

  function buildStaff(opts) {
    staffSeq += 1;
    const staffNumber = `STF-${(2020000 + staffSeq).toString()}`;
    const hesaStaffId = `HS${staffSeq.toString().padStart(7, '0')}`;
    const { first, last } = opts.name ?? pickName(rng);
    const gender = opts.gender ?? rng.weighted(GENDERS_WEIGHTED);
    const ethnicity = rng.weighted(ETHNICITY_WEIGHTED);
    const disability = rng.weighted(DISABILITY_WEIGHTED);
    const isInternational = rng.chance(0.18);
    const nationality = isInternational
      ? rng.pick(['IE','DE','FR','IT','ES','PL','IN','CN','US','CA','AU','NG','GH','PK'])
      : 'GB';
    const title = opts.title ?? rng.pick(opts.category === 'PS' ? PS_TITLES : ACADEMIC_TITLES);
    const dob = opts.dob ?? dobForAge(rng, opts.minAge ?? 30, opts.maxAge ?? 65);
    const email = staffEmail(first, last, '', usedEmails);
    const startDate = opts.startDate ?? new Date(Date.UTC(rng.int(2018, 2024),
      rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10);
    const isLeaver = opts.isLeaver ?? rng.chance(0.05);
    const endDate = isLeaver ? new Date(Date.UTC(rng.int(2020, 2025),
      rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10) : null;
    const dept = opts.department;
    const facultyName = dept ? FACULTIES.find(f => f.code === dept.facultyCode).name : null;
    const departmentId = dept ? deptIdFor(ctx, dept.code) : null;
    const jobTitle = opts.jobTitle;
    const grade = opts.grade;
    const contractType = contractTypeForRole(jobTitle, rng);
    const fte = fteFor(rng, contractType);
    const salary = Math.round(salaryForGrade(rng, grade) * fte);

    const { personId, addressId } = createPerson(ctx, {
      role: 'staff', firstName: first, lastName: last,
      title, dateOfBirth: dob, gender, hesaSexId: genderToHesaSex(gender),
      email, phone: `07${rng.int(700, 999)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
      nationalityCode: nationality, address: fakeAddress(rng, staffSeq),
      createdAt: now, effectiveFrom: startDate + 'T00:00:00Z',
    });

    // Staff row (legacy/shallow)
    staffRows.push({
      id: `staff-${staffNumber.toLowerCase()}`, ...ctx.audit(now),
      staffNumber, title, firstName: first, lastName: last, email,
      departmentName: dept?.name ?? null, facultyName,
      jobTitle, contractType, fte, startDate: startDate + 'T00:00:00Z',
      endDate: endDate ? endDate + 'T00:00:00Z' : null,
      hesaStaffId, costCentre: dept ? ctx.ids.hesaCostCentres.find(c => c.id === ctx.ids.departmentByCode.get(dept.code).hesaCostCentreId)?.code ?? null : null,
      personId,
    });

    // StaffRecord (richer HESA-aligned view)
    const recordId = `srec-${staffNumber.toLowerCase()}`;
    recordRows.push({
      id: recordId, ...ctx.audit(now),
      staffNumber, hesaStaffId, title, firstName: first, lastName: last,
      dateOfBirth: dob + 'T00:00:00Z', gender, ethnicity, disability,
      nationalityCode: nationality, email,
      departmentId, contractLevel: hesaContractLevelFor(jobTitle),
      socCode: socCodeFor(jobTitle),
      academicEmploymentFunction: opts.category === 'ACADEMIC',
      termsOfEmployment: contractType, fte: fte.toFixed(2), fpe: fte.toFixed(2),
      startDate: startDate + 'T00:00:00Z',
      endDate: endDate ? endDate + 'T00:00:00Z' : null,
      annualSalary: salary.toFixed(2),
      clinicalExcellence: false,
      isActive: !isLeaver, personId,
    });

    // 1-3 StaffContract rows over tenure
    const numContracts = rng.weighted([[1, 60], [2, 30], [3, 10]]);
    let contractStart = startDate;
    for (let c = 0; c < numContracts; c++) {
      const contractEnd = c === numContracts - 1 ? endDate :
        new Date(Date.UTC(2018 + c + 1, rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10);
      const cFte = c === 0 ? fte : rng.weighted([[fte, 70], [Math.max(0.4, fte - 0.2), 30]]);
      const spinePoint = STAFF_GRADE_BANDS.find(b => b.grade === grade)?.fromSpine
        ?? rng.int(20, 40);
      contractRows.push({
        id: `cont-${recordId.slice(5)}-${c + 1}`, createdAt: now, updatedAt: now,
        staffRecordId: recordId,
        contractType: c === numContracts - 1 ? contractType : 'FIXED_TERM',
        startDate: contractStart + 'T00:00:00Z',
        endDate: contractEnd ? contractEnd + 'T00:00:00Z' : null,
        fte: cFte.toFixed(2),
        hoursPerWeek: (cFte * 37.5).toFixed(2),
        salary: Math.round(salaryForGrade(rng, grade) * cFte).toFixed(2),
        paySpinePoint: spinePoint + c,
        costCentreCode: dept ? ctx.ids.hesaCostCentres[parseInt(dept.hecos, 10) % ctx.ids.hesaCostCentres.length]?.code ?? null : null,
        activityPercentages: opts.category === 'ACADEMIC'
          ? JSON.stringify({ teaching: 40, research: 40, admin: 20 })
          : JSON.stringify({ admin: 100 }),
        isActive: c === numContracts - 1 && !isLeaver,
      });
      contractStart = contractEnd ?? contractStart;
    }

    // StaffQualifications
    if (opts.category === 'ACADEMIC') {
      qualRows.push({
        id: `sq-${recordId.slice(5)}-1`, createdAt: now, updatedAt: now,
        staffRecordId: recordId, qualificationType: 'PhD',
        subject: dept?.name ?? 'General studies', awardingBody: rng.pick(PEER_INSTITUTIONS),
        yearAwarded: rng.int(1995, 2023), isHighest: true,
      });
      if (rng.chance(0.6)) {
        qualRows.push({
          id: `sq-${recordId.slice(5)}-2`, createdAt: now, updatedAt: now,
          staffRecordId: recordId, qualificationType: 'PGCHE',
          subject: 'Higher Education', awardingBody: INSTITUTION.name,
          yearAwarded: rng.int(2000, 2024), isHighest: false,
        });
      }
    } else {
      qualRows.push({
        id: `sq-${recordId.slice(5)}-1`, createdAt: now, updatedAt: now,
        staffRecordId: recordId, qualificationType: 'BSc',
        subject: rng.pick(['Business', 'Administration', 'Management', 'IT', 'Finance']),
        awardingBody: rng.pick(PEER_INSTITUTIONS),
        yearAwarded: rng.int(1995, 2020), isHighest: true,
      });
    }

    ctx.ids.staffIds.push({
      id: `staff-${staffNumber.toLowerCase()}`,
      recordId, personId, departmentId, jobTitle, category: opts.category, gender, grade,
    });
    if (departmentId) {
      if (!ctx.ids.staffByDepartment.has(departmentId)) {
        ctx.ids.staffByDepartment.set(departmentId, []);
      }
      ctx.ids.staffByDepartment.get(departmentId).push(recordId);
    }
  }

  // 1. Deans — 1 per faculty, grade 9, age 50-65 (attached to faculty's first dept)
  for (const f of FACULTIES) {
    buildStaff({
      department: { ...f.departments[0], facultyCode: f.code },
      jobTitle: 'Professor', grade: 9, category: 'ACADEMIC',
      title: 'Prof.', minAge: 50, maxAge: 65,
    });
  }

  // 2. Heads of Department — 1 per department, grade 8/9
  for (const d of ALL_DEPARTMENTS) {
    buildStaff({
      department: d, jobTitle: 'Professor',
      grade: rng.weighted([[9, 60], [8, 40]]), category: 'ACADEMIC',
      title: 'Prof.', minAge: 45, maxAge: 65,
    });
  }

  // 3. Academic staff per department
  for (const d of ALL_DEPARTMENTS) {
    for (let i = 0; i < ACADEMIC_PER_DEPT; i++) {
      const [jobTitle, grade] = rng.weighted(ACADEMIC_JOB_TITLES.map(([j, g]) => [[j, g], i < 2 ? 30 : 60]));
      buildStaff({
        department: d, jobTitle, grade, category: 'ACADEMIC',
        title: ['Professor', 'Reader'].includes(jobTitle) ? 'Prof.' : 'Dr.',
        minAge: 28, maxAge: 64,
      });
    }
  }

  // 4. Professional services — distributed across faculties + central services
  for (let i = 0; i < PROF_SERVICES_TOTAL; i++) {
    const [jobTitle, grade] = rng.pick(PS_JOB_TITLES);
    // Roughly half attached to a faculty/dept, half central
    const department = rng.chance(0.6) ? rng.pick(ALL_DEPARTMENTS) : null;
    buildStaff({
      department, jobTitle, grade, category: 'PS',
      minAge: 25, maxAge: 65,
    });
  }

  ctx.append('Staff', staffRows);
  ctx.append('StaffRecord', recordRows);
  ctx.append('StaffContract', contractRows);
  ctx.append('StaffQualification', qualRows);

  // 5. External examiners — 50 with subject specialisations matching FHU departments
  const examiners = [];
  for (let i = 0; i < EXTERNAL_EXAMINERS; i++) {
    const { first, last } = pickName(rng);
    const dept = rng.pick(ALL_DEPARTMENTS);
    const id = `extexam-${(i + 1).toString().padStart(3, '0')}`;
    ctx.ids.examinerIds.push({ id, subject: dept.name, departmentCode: dept.code });
    examiners.push({
      id, ...ctx.audit(now),
      name: `Prof. ${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${rng.pick(PEER_INSTITUTIONS).toLowerCase().replace(/[^a-z]/g, '')}.ac.uk`,
      institution: rng.pick(PEER_INSTITUTIONS),
      phone: `0${rng.int(100, 199)} ${rng.int(1000, 9999)} ${rng.int(1000, 9999)}`.slice(0, 18),
      subject: SUBJECTS_PER_DEPT(dept.name), isActive: true,
    });
  }
  ctx.append('ExternalExaminer', examiners);

  // ExternalExaminerAppointment populated in D4 once programmes exist (declared empty for now)

  ctx.log(domain,
    `${staffRows.length} staff (${staffRows.filter(s => !s.endDate).length} active), ` +
    `${recordRows.length} staff records, ${contractRows.length} contracts, ` +
    `${qualRows.length} qualifications, ${examiners.length} external examiners`);
}
