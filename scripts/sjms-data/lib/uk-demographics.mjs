/**
 * UK demographic distributions for the generator.
 *
 * Every distribution is documented with its source. Distributions are
 * synthetic-but-realistic — they reflect open-data UK HE student/staff
 * shapes without mapping any individual row to a real person.
 *
 * Sources:
 *   - HESA Student Statistics 2022/23 (https://www.hesa.ac.uk/data-and-analysis/students)
 *   - HESA Staff Statistics 2022/23   (https://www.hesa.ac.uk/data-and-analysis/staff)
 *   - ONS Census 2021 (England & Wales)
 *   - ONS Office for Students POLAR4 / TUNDRA quintiles
 *   - HMRC postcode area register (geographic identifiers only — no
 *     address-level data)
 *
 * Note on PII: name distributions use UK census top-200 alongside non-UK
 * names representative of the ~30% non-UK-born student population. The
 * combination is randomised so no real-person collision survives the
 * RNG → row pipeline.
 */

// ─── Names ───────────────────────────────────────────────────────────────────
// Ported from v4-integrated/prisma/seed.ts:65–86 — broad UK/non-UK mix.

export const FIRST_NAMES = [
  // Traditional UK / Irish (40)
  'James', 'Mary', 'Robert', 'Patricia', 'Michael', 'Jennifer', 'William', 'Linda',
  'David', 'Barbara', 'Richard', 'Elizabeth', 'Joseph', 'Susan', 'Christopher', 'Sarah',
  'Daniel', 'Karen', 'Matthew', 'Nancy', 'Grace', 'Chloe', 'Ethan', 'Olivia',
  'Noah', 'Sophia', 'Liam', 'Isabella', 'Oliver', 'Emily', 'Harry', 'Amelia',
  'George', 'Mia', 'Jack', 'Ella', 'Charlie', 'Lily', 'Thomas', 'Freya',
  'Henry', 'Poppy', 'Alexander', 'Isla', 'Oscar', 'Ava', 'Arthur', 'Rosie',
  'Leo', 'Florence', 'Callum', 'Niamh', 'Declan', 'Saoirse', 'Rowan', 'Ffion',
  'Ewan', 'Cerys', 'Rhys', 'Sienna',
  // Arab / North African (10)
  'Ahmed', 'Amina', 'Ali', 'Fatima', 'Hassan', 'Layla', 'Miriam', 'Isaac',
  'Ruth', 'Jacob',
  // South Asian (10)
  'Raj', 'Priya', 'Arjun', 'Anjali', 'Vikram', 'Shreya', 'Zainab', 'Omar',
  'Aisha', 'Mohammed',
  // East Asian (10)
  'Wei', 'Ming', 'Ling', 'Zhang', 'Jing', 'Jamal', 'Aaliyah', 'Darius',
  'Nyla', 'Marcus',
  // Hispanic / Latin (10)
  'Zara', 'Lucia', 'Miguel', 'Carmen', 'Diego', 'Rosa', 'Piotr', 'Katarzyna',
  'Andrzej', 'Zofia',
];

export const LAST_NAMES = [
  // Top UK census surnames
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'Martin', 'Lee',
  'Garcia', 'Rodriguez', 'Martinez', 'Thompson', 'White',
  // Arab
  'Al-Abdullah', 'Al-Rashid', 'Al-Mansouri',
  // South Asian
  'Patel', 'Shah', 'Gupta', 'Singh', 'Kumar', 'Sharma', 'Nair',
  // East Asian
  'Yamamoto', 'Tanaka', 'Nakamura', 'Wang', 'Li', 'Liu', 'Chen', 'Yang',
  // African / Caribbean
  'Freeman', 'Baldwin', 'Okonkwo', 'Mensah', 'Adeyemi',
  // Hispanic
  'Gomez', 'Morales', 'Hernandez', 'Castro',
  // Polish / Eastern European
  'Nowak', 'Kowalski', 'Lewandowski',
  // Common UK surnames continued
  'Murphy', 'Campbell', 'Stewart', 'Robertson', 'Walker', 'Mitchell', 'Robinson',
  'Clark', 'Lewis', 'Hall', 'Wright', 'Green', 'Adams', 'Baker', 'Turner',
  'Collins', 'Evans', 'Morris', 'Hughes', 'Edwards', 'Fletcher', 'Barnes',
  'Cooper', 'Carter', 'Ward', 'Bell', 'Cox', 'Reed', 'Bailey', 'Murphy',
];

// ─── Gender / sex ────────────────────────────────────────────────────────────
// HESA Sex Identifier values — 1 Male, 2 Female, 3 Other, 4 Prefer not to say.
// Distribution: HESA SEXID returns 2022/23 (M 43% / F 56% / Other 0.5% / PNS 0.5%).
export const GENDERS_WEIGHTED = [
  ['MALE', 43],
  ['FEMALE', 56],
  ['OTHER', 0.5],
  ['PREFER_NOT_TO_SAY', 0.5],
];

// HESA-aligned ethnicity categories. Distribution skewed toward UK
// majority but with non-UK domiciled overlay.
// Source: HESA ETHNIC codes simplified.
export const ETHNICITY_WEIGHTED = [
  ['WHITE_BRITISH', 56],
  ['WHITE_IRISH', 2],
  ['WHITE_OTHER', 6],
  ['ASIAN_INDIAN', 6],
  ['ASIAN_PAKISTANI', 5],
  ['ASIAN_BANGLADESHI', 2],
  ['ASIAN_CHINESE', 4],
  ['ASIAN_OTHER', 3],
  ['BLACK_AFRICAN', 5],
  ['BLACK_CARIBBEAN', 2],
  ['BLACK_OTHER', 1],
  ['MIXED_WHITE_ASIAN', 1],
  ['MIXED_WHITE_BLACK', 1],
  ['MIXED_OTHER', 2],
  ['ARAB', 1.5],
  ['OTHER_ETHNIC', 1],
  ['PREFER_NOT_TO_SAY', 1.5],
];

// HESA disability declaration. ~17% of UK HE students declare a disability
// (HESA Student Statistics 2022/23 — DISABLE returns).
export const DISABILITY_WEIGHTED = [
  ['NONE', 75],
  ['MENTAL_HEALTH_CONDITION', 8],
  ['LEARNING_DIFFICULTY', 6],          // SpLD — dyslexia, dyscalculia, ADHD
  ['LONG_TERM_ILLNESS', 3],
  ['PHYSICAL_DISABILITY', 1.5],
  ['SENSORY_DISABILITY', 1],
  ['DEVELOPMENTAL_DISORDER', 1.5],     // ASD, etc.
  ['MULTIPLE_DISABILITIES', 1],
  ['OTHER_DISABILITY', 1],
  ['PREFER_NOT_TO_SAY', 2],
];

// Domicile country split — ~75% UK-domiciled (HESA domicile statistics 2022/23
// for the typical post-92 institution).
export const DOMICILES_WEIGHTED = [
  ['GB-ENG', 65],
  ['GB-SCT', 3],
  ['GB-WLS', 3],
  ['GB-NIR', 1],
  ['IE', 1],
  ['CN', 5],          // China — largest non-EU sender
  ['IN', 3],          // India
  ['NG', 2],          // Nigeria
  ['PK', 2],          // Pakistan
  ['US', 1.5],
  ['DE', 1],
  ['FR', 1],
  ['PL', 1],
  ['IT', 0.5],
  ['ES', 0.5],
  ['GH', 0.8],
  ['MY', 0.7],
  ['SG', 0.6],
  ['JP', 0.4],
  ['CA', 0.5],
  ['AU', 0.3],
  ['ZA', 0.3],
  ['EG', 0.4],
  ['SA', 0.4],
  ['AE', 0.4],
  ['KE', 0.3],
  ['BR', 0.4],
  ['MX', 0.3],
  ['OTHER', 4],
];

// Fee status — UK universities collapse domicile into Home / Overseas
// (Northern Ireland / Scottish / Welsh subcategories where relevant).
export const FEE_STATUS_WEIGHTED = [
  ['HOME', 75],
  ['OVERSEAS', 22],
  ['ISLAND', 1],            // Channel Islands / Isle of Man
  ['EU_REINSTATED', 2],     // EU students under continuing-rights arrangements
];

// POLAR4 / TUNDRA quintile — Office for Students participation classification.
// Q1 = lowest participation, Q5 = highest. ~20% in each for a balanced
// institution; widening-participation institutions skew Q1/Q2.
export const POLAR_QUINTILES_WEIGHTED = [
  ['Q1', 22],
  ['Q2', 22],
  ['Q3', 20],
  ['Q4', 19],
  ['Q5', 17],
];

// Mode of study — applies to UG primarily.
export const MODES_OF_STUDY = ['FULL_TIME', 'PART_TIME', 'SANDWICH', 'DISTANCE'];

// Level of study split for active student body.
export const STUDENT_LEVELS_WEIGHTED = [
  ['UG', 60],          // Undergraduate
  ['PGT', 30],         // Postgraduate taught
  ['PGR', 10],         // Postgraduate research
];

// Within UG: full-time vs part-time
export const UG_MODE_WEIGHTED = [
  ['FULL_TIME', 75],
  ['PART_TIME', 25],
];

// ─── Postcodes ───────────────────────────────────────────────────────────────
// Realistic UK postcode area prefixes (geographic identifiers only).
// Generator combines prefix + random outward digit + random inward block.
// Source: Royal Mail postcode area register (open data).
export const POSTCODE_AREAS = [
  'M', 'L', 'B', 'NG', 'S', 'LE', 'CV', 'NN', 'NR', 'IP',          // Midlands / North
  'CB', 'CO', 'CM', 'SS', 'RM', 'IG', 'E', 'EC', 'N', 'NW',         // East / London
  'W', 'WC', 'SE', 'SW', 'CR', 'BR', 'DA', 'TN', 'ME', 'CT',        // London / South-East
  'BN', 'GU', 'RG', 'SL', 'OX', 'HP', 'AL', 'LU', 'SG', 'WD',       // South / Home Counties
  'TW', 'KT', 'SM', 'HA', 'UB', 'BA', 'BS', 'TA', 'EX', 'PL',       // South / South-West
  'TQ', 'TR', 'DT', 'BH', 'SO', 'PO', 'SP', 'GL', 'HR', 'WR',       // South-West / Welsh borders
  'CF', 'NP', 'SA', 'SY', 'LD', 'LL',                                // Wales
  'EH', 'G', 'KY', 'FK', 'PA', 'KA', 'ML', 'TD', 'DG', 'AB',        // Scotland
  'IV', 'PH', 'HS', 'KW', 'ZE', 'IM', 'JE', 'GY',                   // Scotland / Crown Dependencies
  'BT',                                                              // NI
];

// ─── Age cohorts ─────────────────────────────────────────────────────────────
// Distribution of student ages at enrolment — HESA Student Statistics 2022/23.
// "Young" = under 21 at start of academic year. Most UG are young; PGT skews older.
export const UG_AGE_AT_ENROLMENT_MEAN = 19.4;
export const UG_AGE_AT_ENROLMENT_STDDEV = 2.8;
export const PGT_AGE_AT_ENROLMENT_MEAN = 26.5;
export const PGT_AGE_AT_ENROLMENT_STDDEV = 5.2;
export const PGR_AGE_AT_ENROLMENT_MEAN = 29.8;
export const PGR_AGE_AT_ENROLMENT_STDDEV = 4.5;

// ─── Staff ───────────────────────────────────────────────────────────────────
// UCEA single pay spine — points 1 to 51 covering ~£20k to ~£70k base
// salary plus the unscaled professorial range above.
// Source: UCEA pay spine 2024/25.
export const STAFF_GRADE_BANDS = [
  { grade: 1, fromSpine: 1,  toSpine: 5,  minSalary: 20000, maxSalary: 22500, exampleRole: 'Operational Services' },
  { grade: 2, fromSpine: 6,  toSpine: 11, minSalary: 22500, maxSalary: 24500, exampleRole: 'Administrative Officer' },
  { grade: 3, fromSpine: 12, toSpine: 17, minSalary: 24500, maxSalary: 28800, exampleRole: 'Library Assistant' },
  { grade: 4, fromSpine: 18, toSpine: 23, minSalary: 28800, maxSalary: 33000, exampleRole: 'Faculty Coordinator' },
  { grade: 5, fromSpine: 24, toSpine: 29, minSalary: 33000, maxSalary: 38000, exampleRole: 'Senior Officer / Lecturer Teaching Fellow' },
  { grade: 6, fromSpine: 30, toSpine: 35, minSalary: 38000, maxSalary: 47000, exampleRole: 'Lecturer / Senior Lecturer' },
  { grade: 7, fromSpine: 36, toSpine: 41, minSalary: 47000, maxSalary: 58000, exampleRole: 'Senior Lecturer / Reader' },
  { grade: 8, fromSpine: 42, toSpine: 47, minSalary: 58000, maxSalary: 70000, exampleRole: 'Principal Lecturer / Associate Professor' },
  { grade: 9, fromSpine: 48, toSpine: 51, minSalary: 70000, maxSalary: 100000, exampleRole: 'Professor' },
  { grade: 'P', fromSpine: 0, toSpine: 0, minSalary: 100000, maxSalary: 180000, exampleRole: 'Pro-Vice Chancellor / DVC / VC' },
];

// Staff category distribution.
export const STAFF_CATEGORIES_WEIGHTED = [
  ['ACADEMIC', 60],
  ['PROFESSIONAL_SERVICES', 35],
  ['SENIOR_LEADERSHIP', 5],
];

// Within academic staff — contract function. HESA Staff Statistics ACEMPFUN.
export const ACADEMIC_FUNCTIONS_WEIGHTED = [
  ['TEACHING_ONLY', 30],
  ['TEACHING_AND_RESEARCH', 50],
  ['RESEARCH_ONLY', 18],
  ['NEITHER_TEACHING_NOR_RESEARCH', 2],
];

// Contract type — HESA Staff Statistics CONTRACT.
export const CONTRACT_TYPES_WEIGHTED = [
  ['PERMANENT', 70],
  ['FIXED_TERM', 22],
  ['ATYPICAL', 5],
  ['HOURLY_PAID', 3],
];

// Full-time equivalent distribution among non-permanent / non-fulltime staff.
export const FTE_PART_TIME_VALUES = [0.2, 0.4, 0.5, 0.6, 0.8];

// ─── Programme + course ──────────────────────────────────────────────────────

export const FHEQ_LEVELS = ['3', '4', '5', '6', '7', '8'];   // Foundation through doctoral

// Programme-type weights for the curriculum generator.
export const PROGRAMME_TYPES_WEIGHTED = [
  ['BSC', 25],        // Bachelor of Science
  ['BA', 22],         // Bachelor of Arts
  ['MENG', 4],        // Integrated Master of Engineering
  ['MSC', 18],        // Master of Science
  ['MA', 12],         // Master of Arts
  ['MBA', 3],         // Master of Business Administration
  ['MRES', 1],        // Master of Research
  ['MPHIL', 2],       // Master of Philosophy
  ['PHD', 7],         // Doctor of Philosophy
  ['EDD', 0.5],       // Doctor of Education
  ['LLB', 3],         // Bachelor of Laws
  ['LLM', 1.5],       // Master of Laws
  ['FDA', 1],         // Foundation Degree (Arts)
];

// Standard assessment-component types
export const ASSESSMENT_TYPES = [
  'COURSEWORK', 'EXAM', 'PRESENTATION', 'LAB_REPORT', 'ESSAY',
  'PORTFOLIO', 'GROUP_PROJECT', 'DISSERTATION', 'PRACTICAL', 'VIVA',
];

// Mark distribution — N(58, 12) clamped to [0, 100]. Reasonable for UK HE
// where ~10% fail at module level and the modal degree class is 2:1.
export const MARK_DISTRIBUTION_MEAN = 58;
export const MARK_DISTRIBUTION_STDDEV = 12;

// UK degree classifications — boundaries used by classification rules.
export const CLASSIFICATIONS = {
  FIRST:        { min: 70, label: 'First-class honours' },
  UPPER_SECOND: { min: 60, label: 'Upper second-class honours (2:1)' },
  LOWER_SECOND: { min: 50, label: 'Lower second-class honours (2:2)' },
  THIRD:        { min: 40, label: 'Third-class honours' },
  PASS:         { min: 35, label: 'Pass' },
  FAIL:         { min: 0,  label: 'Fail' },
};
