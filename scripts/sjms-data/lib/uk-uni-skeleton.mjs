/**
 * Future Horizons University — canonical 6-faculty / 48-department skeleton.
 *
 * Ported and scaled from `RJK134/sjms-v4-integrated/scripts/seed.ts` (the
 * authoritative governance reference data per docs/dataset/SCHEMA-MAPPING.md
 * §7). The 6 faculties from the v4 seed are kept verbatim; each faculty
 * grows from 5 to 8 departments to hit the ~48-department target a
 * 40k-student UK university typically runs.
 *
 * Sources for departmental HECOS codes:
 *   - HESA HECOS subject codes (https://www.hesa.ac.uk/innovation/hecos)
 *   - JISC subject taxonomy
 *
 * NOT IN SCHEMA per §3 of the schema-mapping doc:
 *   - No School tier (v4 schema is Faculty → Department, 2-tier flat)
 *   - No ResearchCentre / Institute / OrganisationUnit
 *   - Council / Senate / standing committees are emitted as Committee
 *     instances by governance.mjs, differentiated by committeeType
 */

export const INSTITUTION = {
  name: 'Future Horizons University',
  shortName: 'FHU',
  ukprn: '10099999',
  city: 'Future Horizons City',
  county: 'Future Horizons',
  domain: 'fhe.ac.uk',
};

/**
 * 6 faculties × 8 departments = 48 departments.
 *
 * Each department has:
 *   - name        - public-facing display name
 *   - code        - 3-5 char identifier used in programme codes
 *   - hecos       - HESA HECOS subject code (6 digits, leading zeros preserved as string)
 */
export const FACULTIES = [
  {
    name: 'Faculty of Arts & Humanities',
    code: 'AHU',
    departments: [
      { name: 'English', code: 'ENG', hecos: '100075' },
      { name: 'History', code: 'HIS', hecos: '100118' },
      { name: 'Philosophy', code: 'PHI', hecos: '100160' },
      { name: 'Modern Languages', code: 'MLG', hecos: '100169' },
      { name: 'Theology & Religious Studies', code: 'THS', hecos: '100178' },
      { name: 'Classics & Ancient History', code: 'CLA', hecos: '100299' },
      { name: 'Archaeology', code: 'ARC', hecos: '100298' },
      { name: 'Liberal Arts', code: 'LBA', hecos: '100337' },
    ],
  },
  {
    name: 'Faculty of Science & Engineering',
    code: 'SEN',
    departments: [
      { name: 'Computer Science', code: 'CS', hecos: '100346' },
      { name: 'Mathematics', code: 'MAT', hecos: '100078' },
      { name: 'Physics', code: 'PHY', hecos: '100088' },
      { name: 'Chemistry', code: 'CHM', hecos: '100086' },
      { name: 'Engineering', code: 'EGN', hecos: '100223' },
      { name: 'Civil Engineering', code: 'CIV', hecos: '100148' },
      { name: 'Electrical & Electronic Engineering', code: 'EEE', hecos: '100164' },
      { name: 'Mechanical Engineering', code: 'MEC', hecos: '100190' },
    ],
  },
  {
    name: 'Faculty of Health & Life Sciences',
    code: 'HLS',
    departments: [
      { name: 'Nursing & Midwifery', code: 'NUR', hecos: '100369' },
      { name: 'Biomedical Sciences', code: 'BMS', hecos: '100101' },
      { name: 'Sport & Exercise Sciences', code: 'SES', hecos: '100137' },
      { name: 'Psychology', code: 'PSY', hecos: '100116' },
      { name: 'Pharmacy', code: 'PHR', hecos: '100380' },
      { name: 'Public Health', code: 'PUH', hecos: '100476' },
      { name: 'Physiotherapy', code: 'PTY', hecos: '100388' },
      { name: 'Biology', code: 'BIO', hecos: '100091' },
    ],
  },
  {
    name: 'Faculty of Business & Law',
    code: 'BLW',
    departments: [
      { name: 'Accounting & Finance', code: 'ACC', hecos: '100448' },
      { name: 'Business Management', code: 'BUS', hecos: '100453' },
      { name: 'Law', code: 'LAW', hecos: '100195' },
      { name: 'Economics', code: 'ECN', hecos: '100054' },
      { name: 'Marketing', code: 'MKT', hecos: '100468' },
      { name: 'International Business', code: 'IBS', hecos: '100485' },
      { name: 'Human Resource Management', code: 'HRM', hecos: '100464' },
      { name: 'Tourism & Hospitality', code: 'THM', hecos: '100888' },
    ],
  },
  {
    name: 'Faculty of Social Sciences & Education',
    code: 'SSE',
    departments: [
      { name: 'Education', code: 'EDU', hecos: '100206' },
      { name: 'Sociology', code: 'SOC', hecos: '100125' },
      { name: 'Politics & International Relations', code: 'POL', hecos: '100135' },
      { name: 'Social Work', code: 'SWK', hecos: '100332' },
      { name: 'Criminology', code: 'CRM', hecos: '100122' },
      { name: 'Social Policy', code: 'SPP', hecos: '100454' },
      { name: 'Geography', code: 'GEO', hecos: '100126' },
      { name: 'Anthropology', code: 'ANT', hecos: '100489' },
    ],
  },
  {
    name: 'Faculty of Creative & Digital Industries',
    code: 'CDI',
    departments: [
      { name: 'Architecture', code: 'ARH', hecos: '100257' },
      { name: 'Creative Writing & Media', code: 'CWM', hecos: '100065' },
      { name: 'Film & Television', code: 'FLM', hecos: '100067' },
      { name: 'Music', code: 'MUS', hecos: '100073' },
      { name: 'Art & Design', code: 'ART', hecos: '100076' },
      { name: 'Drama & Performance', code: 'DRA', hecos: '100264' },
      { name: 'Digital Media Production', code: 'DMP', hecos: '100366' },
      { name: 'Games Design & Development', code: 'GMD', hecos: '100367' },
    ],
  },
];

/** Flat list of departments with faculty back-reference */
export const ALL_DEPARTMENTS = FACULTIES.flatMap((f) =>
  f.departments.map((d) => ({ ...d, facultyCode: f.code, facultyName: f.name })),
);

/**
 * Standing committees emitted by governance.mjs as Committee instances.
 * Each shows a typical UK university governance pattern per the CUC HE Code
 * of Governance and the AdvanceHE governance toolkit.
 */
export const STANDING_COMMITTEES = [
  // Governance bodies — top tier
  { name: 'Council',                       committeeType: 'ACADEMIC_BOARD',     meetingFrequency: 'TERMLY' },
  { name: 'Senate',                        committeeType: 'SENATE',             meetingFrequency: 'MONTHLY' },
  { name: 'Executive Board',               committeeType: 'ACADEMIC_BOARD',     meetingFrequency: 'WEEKLY' },
  // Standing committees of Council / Senate
  { name: 'Audit Committee',               committeeType: 'FINANCE',            meetingFrequency: 'TERMLY' },
  { name: 'Finance & Investment Committee',committeeType: 'FINANCE',            meetingFrequency: 'TERMLY' },
  { name: 'Nominations Committee',         committeeType: 'ACADEMIC_BOARD',     meetingFrequency: 'TERMLY' },
  { name: 'Remuneration Committee',        committeeType: 'FINANCE',            meetingFrequency: 'TERMLY' },
  { name: 'Education Committee',           committeeType: 'LEARNING_TEACHING',  meetingFrequency: 'MONTHLY' },
  { name: 'Research & Innovation Committee', committeeType: 'RESEARCH',         meetingFrequency: 'MONTHLY' },
  { name: 'Quality Assurance Committee',   committeeType: 'QUALITY_ASSURANCE',  meetingFrequency: 'MONTHLY' },
  { name: 'Equality, Diversity & Inclusion Committee', committeeType: 'EQUALITY_DIVERSITY', meetingFrequency: 'TERMLY' },
  { name: 'Health & Safety Committee',     committeeType: 'HEALTH_SAFETY',      meetingFrequency: 'TERMLY' },
  { name: 'Student Experience Committee',  committeeType: 'STUDENT_EXPERIENCE', meetingFrequency: 'MONTHLY' },
  { name: 'Ethics Committee',              committeeType: 'RESEARCH',           meetingFrequency: 'MONTHLY' },
];

/** Faculty-level boards (one per faculty) */
export function facultyBoards() {
  return FACULTIES.flatMap((f) => [
    { name: `${f.name} Board`, committeeType: 'FACULTY_BOARD', meetingFrequency: 'TERMLY', facultyCode: f.code },
    { name: `${f.name} Education Committee`, committeeType: 'LEARNING_TEACHING', meetingFrequency: 'MONTHLY', facultyCode: f.code },
    { name: `${f.name} Research Committee`, committeeType: 'RESEARCH', meetingFrequency: 'MONTHLY', facultyCode: f.code },
  ]);
}

/** Programme-level exam boards (one per department per academic year — emitted by assessment.mjs) */
export function examBoardName(departmentName, academicYear) {
  return `${departmentName} Exam Board ${academicYear}`;
}
