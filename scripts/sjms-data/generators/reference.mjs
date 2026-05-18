/**
 * reference generator (D2)
 *
 * Lookup tables every downstream domain depends on. Populated entirely
 * from open-data sources (HESA Coding Manual, HECOS subject taxonomy,
 * ONS SOC2020). No internal-org state.
 *
 * Volumes:
 *   AcademicYear                  7   (2020/21 .. 2026/27)
 *   HesaCostCentre               ~40  (HESA standard cost-centre codes)
 *   HesaHecosCode                ~50  (covers all FHU departments)
 *   HesaSocCode                  ~30  (ONS Standard Occupational Classification 2020)
 *   HesaQualificationAim         ~12  (foundation, BSc, BA, MEng, MSc, PhD, etc.)
 *   HesaStaffContractLevel       ~10  (HESA ACEMPFUN contract level lookup)
 *   HesaReasonForEndingLookup    ~15
 *   HesaCodingFrame              ~30  (coding frame index)
 *   HesaCodingFrameVersion        3
 *   HesaQualityRule              ~20  (validation rule catalogue)
 *   DocumentTemplate             ~10
 *   CommunicationTemplate        ~10
 *   ProgressionRule               0   (populated in D4 — needs ProgrammeVersion)
 *   HesaSessionYear               0   (populated in D6 — needs HesaSnapshot)
 */

import { modelsByDomain } from '../lib/domain-map.mjs';
import { ACADEMIC_YEARS, CURRENT_ACTIVE_YEAR, ayStartDate, ayEndDate } from '../lib/academic-calendar.mjs';

export const domain = 'reference';

const HESA_COST_CENTRES = [
  ['100', 'Clinical medicine', 'MED', 'Medicine, dentistry & health'],
  ['101', 'Clinical dentistry', 'MED', 'Medicine, dentistry & health'],
  ['102', 'Veterinary science', 'VET', 'Veterinary science'],
  ['103', 'Anatomy & physiology', 'BIO', 'Biological & sport sciences'],
  ['104', 'Nursing & allied health', 'HLT', 'Subjects allied to medicine'],
  ['105', 'Health & community studies', 'HLT', 'Subjects allied to medicine'],
  ['106', 'Pharmacy & pharmacology', 'PHA', 'Subjects allied to medicine'],
  ['107', 'Biosciences', 'BIO', 'Biological & sport sciences'],
  ['108', 'Sport & exercise science', 'BIO', 'Biological & sport sciences'],
  ['109', 'Psychology & behavioural sciences', 'PSY', 'Psychology'],
  ['110', 'Chemistry', 'PSC', 'Physical sciences'],
  ['111', 'Physics', 'PSC', 'Physical sciences'],
  ['112', 'Earth, marine & environmental sciences', 'PSC', 'Physical sciences'],
  ['113', 'Mathematics', 'MAT', 'Mathematical sciences'],
  ['114', 'IT, systems sciences & computer software engineering', 'ICT', 'Computing'],
  ['115', 'General engineering', 'ENG', 'Engineering & technology'],
  ['116', 'Mechanical, aero & production engineering', 'ENG', 'Engineering & technology'],
  ['117', 'Civil engineering', 'ENG', 'Engineering & technology'],
  ['118', 'Electrical, electronic & computer engineering', 'ENG', 'Engineering & technology'],
  ['119', 'Chemical engineering', 'ENG', 'Engineering & technology'],
  ['120', 'Mineral, metallurgy & materials engineering', 'ENG', 'Engineering & technology'],
  ['121', 'Architecture, built environment & planning', 'ABP', 'Architecture, building & planning'],
  ['122', 'Geography & environmental studies', 'GEO', 'Geographical, earth & environmental studies'],
  ['123', 'Area studies', 'HUM', 'Humanities & language-based studies'],
  ['124', 'Archaeology', 'HUM', 'Humanities & language-based studies'],
  ['125', 'Anthropology & development studies', 'SOC', 'Social sciences'],
  ['126', 'Politics & international studies', 'SOC', 'Social sciences'],
  ['127', 'Economics & econometrics', 'BUS', 'Business & administrative studies'],
  ['128', 'Law', 'LAW', 'Law'],
  ['129', 'Social work & social policy', 'SOC', 'Social sciences'],
  ['130', 'Sociology', 'SOC', 'Social sciences'],
  ['131', 'Business & management studies', 'BUS', 'Business & administrative studies'],
  ['132', 'Catering & hospitality management', 'BUS', 'Business & administrative studies'],
  ['133', 'Education', 'EDU', 'Education & teaching'],
  ['134', 'Continuing education', 'EDU', 'Education & teaching'],
  ['135', 'Modern languages', 'HUM', 'Humanities & language-based studies'],
  ['136', 'English language & literature', 'HUM', 'Humanities & language-based studies'],
  ['137', 'History', 'HUM', 'Humanities & language-based studies'],
  ['138', 'Classics', 'HUM', 'Humanities & language-based studies'],
  ['139', 'Philosophy', 'HUM', 'Humanities & language-based studies'],
  ['140', 'Theology & religious studies', 'HUM', 'Humanities & language-based studies'],
  ['141', 'Art & design', 'CRT', 'Creative arts & design'],
  ['142', 'Music, drama, dance & performing arts', 'CRT', 'Creative arts & design'],
  ['143', 'Media studies', 'CRT', 'Creative arts & design'],
  ['144', 'Library & information management', 'LBR', 'Library & information management'],
];

const HECOS_CODES = [
  // Subset spanning every department in uk-uni-skeleton.FACULTIES
  ['100075', 'English studies'],   ['100118', 'History'],
  ['100160', 'Philosophy'],         ['100169', 'Modern languages'],
  ['100178', 'Theology & religious studies'], ['100299', 'Classics'],
  ['100298', 'Archaeology'],        ['100337', 'Liberal arts'],
  ['100346', 'Computer science'],   ['100078', 'Mathematics'],
  ['100088', 'Physics'],            ['100086', 'Chemistry'],
  ['100223', 'Engineering (non-specific)'], ['100148', 'Civil engineering'],
  ['100164', 'Electrical & electronic engineering'], ['100190', 'Mechanical engineering'],
  ['100369', 'Nursing & midwifery'],['100101', 'Biomedical sciences'],
  ['100091', 'Biology'],
  ['100137', 'Sports & exercise sciences'], ['100116', 'Psychology'],
  ['100380', 'Pharmacy'],           ['100476', 'Public health'],
  ['100388', 'Physiotherapy'],      ['100448', 'Accounting'],
  ['100453', 'Business management'],['100195', 'Law'],
  ['100054', 'Economics'],          ['100468', 'Marketing'],
  ['100485', 'International business'], ['100464', 'Human resource management'],
  ['100888', 'Tourism & hospitality management'], ['100206', 'Education'],
  ['100125', 'Sociology'],          ['100135', 'Politics & international relations'],
  ['100332', 'Social work'],        ['100122', 'Criminology'],
  ['100454', 'Social policy'],      ['100126', 'Geography'],
  ['100489', 'Anthropology'],       ['100257', 'Architecture'],
  ['100065', 'Creative writing'],   ['100067', 'Film & television studies'],
  ['100073', 'Music'],              ['100076', 'Art & design (non-specific)'],
  ['100264', 'Drama & performance'],['100366', 'Digital media'],
  ['100367', 'Computer games design'],
  ['100401', 'Environmental science'], ['100263', 'Performing arts'],
];

const SOC_CODES = [
  ['2311', 'Higher education teaching professionals', '2'],
  ['2312', 'Further education teaching professionals', '2'],
  ['2314', 'Secondary education teaching professionals', '2'],
  ['2421', 'Chartered & certified accountants', '2'],
  ['2231', 'Nurses', '2'],
  ['1132', 'Marketing & sales directors', '1'],
  ['1162', 'Financial managers & directors', '1'],
  ['1171', 'Information technology & telecommunications directors', '1'],
  ['1182', 'Healthcare practice managers', '1'],
  ['1184', 'Education & training directors', '1'],
  ['2126', 'Design & development engineers', '2'],
  ['2133', 'IT specialist managers', '2'],
  ['2136', 'Programmers & software development professionals', '2'],
  ['2419', 'Legal professionals n.e.c.', '2'],
  ['2425', 'Management consultants & business analysts', '2'],
  ['2432', 'Town planning officers', '2'],
  ['2461', 'Quality assurance & regulatory professionals', '2'],
  ['2471', 'Journalists, newspaper & periodical editors', '2'],
  ['3417', 'Authors, writers & translators', '3'],
  ['3422', 'Product, clothing & related designers', '3'],
  ['3554', 'Vehicle body builders & repairers', '3'],
  ['4131', 'Pensions & insurance clerks', '4'],
  ['4151', 'Sales administrators', '4'],
  ['7115', 'Telephonists', '7'],
  ['9120', 'Elementary administration occupations', '9'],
  ['1115', 'Chief executives & senior officials', '1'],
  ['2429', 'Solicitors', '2'],
  ['2434', 'Chartered surveyors', '2'],
  ['2435', 'Architects', '2'],
  ['2436', 'Town planning support staff', '2'],
];

const QUALIFICATION_AIMS = [
  ['F40', 'First degree (BA, BSc, BEng)', 6, 'UG_BACHELOR'],
  ['F41', 'Foundation degree (FdA, FdSc)', 5, 'UG_FOUNDATION_DEGREE'],
  ['F42', 'Higher National Diploma (HND)', 5, 'UG_HND'],
  ['F43', 'Integrated masters (MEng, MMath, MChem, MPhys)', 7, 'UG_INTEGRATED_MASTERS'],
  ['F44', 'LLB Bachelor of Laws', 6, 'UG_LLB'],
  ['M30', 'Postgraduate taught masters (MA, MSc, MBA)', 7, 'PGT_MASTERS'],
  ['M40', 'Postgraduate research (MPhil)', 7, 'PGR_MPHIL'],
  ['M50', 'Doctorate (PhD, EdD)', 8, 'PGR_DOCTORATE'],
  ['M70', 'Postgraduate certificate (PGCert)', 7, 'PGT_PGCERT'],
  ['M71', 'Postgraduate diploma (PGDip)', 7, 'PGT_PGDIP'],
  ['H80', 'Foundation year (preparation for HE)', 3, 'FOUNDATION'],
  ['C10', 'Continuing professional development (CPD)', 0, 'CPD'],
];

const STAFF_CONTRACT_LEVELS = [
  ['A0', 'Operational services',          false, 1],
  ['A1', 'Administrative officer',         false, 2],
  ['A2', 'Senior administrative officer',  false, 3],
  ['B0', 'Teaching fellow',                true,  4],
  ['B1', 'Lecturer',                       true,  5],
  ['B2', 'Senior lecturer',                true,  6],
  ['C0', 'Reader',                         true,  7],
  ['C1', 'Professor',                      true,  8],
  ['C2', 'Chair professor',                true,  9],
  ['D0', 'Senior management',              false, 10],
];

const REASONS_FOR_ENDING = [
  ['00', 'Currently registered',                                          'IN_PROGRESS'],
  ['01', 'Successfully completed',                                         'COMPLETION'],
  ['02', 'Successfully completed — written-off after lapse of time',       'COMPLETION'],
  ['03', 'Transferred to another HEI',                                     'TRANSFER'],
  ['04', 'Transferred to another programme in same HEI',                   'TRANSFER'],
  ['05', 'Death',                                                          'OTHER'],
  ['06', 'Other personal reasons',                                         'WITHDRAWAL'],
  ['07', 'Financial reasons',                                              'WITHDRAWAL'],
  ['08', 'Health reasons',                                                 'WITHDRAWAL'],
  ['09', 'Academic failure / left in bad standing',                        'WITHDRAWAL'],
  ['10', 'Disciplinary measures / suspension',                             'WITHDRAWAL'],
  ['11', 'Goal achieved without award',                                    'COMPLETION'],
  ['98', 'Other reason',                                                   'OTHER'],
  ['99', 'Reason not known',                                               'OTHER'],
];

const QUALITY_RULES = [
  ['HQ01', 'HUSID format',           '13-digit numeric with checksum',      'HIGH'],
  ['HQ02', 'Date of birth plausible','Must be 16 < age < 120',              'HIGH'],
  ['HQ03', 'Postcode format',         'UK postcode pattern',                 'MEDIUM'],
  ['HQ04', 'Domicile vs nationality','Must be reconcilable',                'MEDIUM'],
  ['HQ05', 'Disability code valid', 'Must be in HESA DISABLE codeframe',    'HIGH'],
  ['HQ06', 'Ethnicity code valid',  'Must be in HESA ETHNIC codeframe',     'HIGH'],
  ['HQ07', 'Fee status consistent', 'Must align with domicile + nationality','HIGH'],
  ['HQ08', 'Mode of study valid',   'Must be FT/PT/SW/DL',                  'MEDIUM'],
  ['HQ09', 'HECOS code valid',      'Must be in published HECOS register',   'HIGH'],
  ['HQ10', 'Tariff points valid',   'UCAS tariff calculation correct',       'MEDIUM'],
  ['HQ11', 'Programme duration consistent', 'Years match qualification aim','MEDIUM'],
  ['HQ12', 'Module credits sum',    'Total credits per year per UK norms (60–120)','HIGH'],
  ['HQ13', 'Mark in range',         'Marks must be 0–100',                   'HIGH'],
  ['HQ14', 'Classification rule',   'Final class follows institution-approved rule','HIGH'],
  ['HQ15', 'Award conferred',       'Award date present where status=COMPLETED','HIGH'],
  ['HQ16', 'HUSID lifelong',        'Same HUSID across all sessions',        'CRITICAL'],
  ['HQ17', 'CAS valid for sponsorship', 'CAS reference exists for sponsored students','HIGH'],
  ['HQ18', 'Reason for ending coherent','Must align with completion outcome','MEDIUM'],
  ['HQ19', 'Apprenticeship OTJ ratio','OTJ ≥ 20% of off-the-job hours',      'HIGH'],
  ['HQ20', 'Engagement signal present','Active enrolments have engagement', 'LOW'],
];

const DOCUMENT_TEMPLATES = [
  ['OFFER_LETTER',     'PDF', 'Offer Letter (Conditional)'],
  ['OFFER_LETTER_UNCONDITIONAL', 'PDF', 'Offer Letter (Unconditional)'],
  ['TRANSCRIPT',       'PDF', 'Academic Transcript'],
  ['CERTIFICATE',      'PDF', 'Degree Certificate'],
  ['INVOICE',          'PDF', 'Fee Invoice'],
  ['RECEIPT',          'PDF', 'Payment Receipt'],
  ['CAS_LETTER',       'PDF', 'CAS Letter (UKVI)'],
  ['ENROLMENT_LETTER', 'PDF', 'Enrolment Confirmation'],
  ['HARDSHIP_DECISION','PDF', 'Hardship Fund Decision'],
  ['EXAM_BOARD_AGENDA','PDF', 'Exam Board Agenda'],
];

const COMMUNICATION_TEMPLATES = [
  ['APPLICATION_RECEIVED',  'EMAIL', 'Application acknowledgement'],
  ['OFFER_ISSUED',          'EMAIL', 'Offer issued'],
  ['OFFER_FIRMED',          'EMAIL', 'Offer firm acceptance acknowledged'],
  ['ENROLMENT_INVITE',      'EMAIL', 'Enrolment invitation'],
  ['ENROLMENT_COMPLETE',    'EMAIL', 'Enrolment completed'],
  ['MARKS_RELEASED',        'EMAIL', 'Marks released'],
  ['EXAM_BOARD_RESULT',     'EMAIL', 'Exam Board result released'],
  ['FEE_DUE',               'EMAIL', 'Fee payment due'],
  ['FEE_OVERDUE',           'EMAIL', 'Fee payment overdue'],
  ['HESA_RETURN_VALIDATED', 'EMAIL', 'HESA return validated'],
];

const CODING_FRAMES = [
  // (codingType, code, description, validFrom)
  ['HESA_ETHNIC', '01', 'White – British', '2020-08-01'],
  ['HESA_ETHNIC', '10', 'White – Irish', '2020-08-01'],
  ['HESA_ETHNIC', '11', 'White – Gypsy or Irish Traveller', '2020-08-01'],
  ['HESA_ETHNIC', '12', 'White – Roma', '2020-08-01'],
  ['HESA_ETHNIC', '19', 'White – Other', '2020-08-01'],
  ['HESA_ETHNIC', '20', 'Mixed/multiple – White & Black Caribbean', '2020-08-01'],
  ['HESA_ETHNIC', '21', 'Mixed/multiple – White & Black African', '2020-08-01'],
  ['HESA_ETHNIC', '22', 'Mixed/multiple – White & Asian', '2020-08-01'],
  ['HESA_ETHNIC', '29', 'Mixed/multiple – Other', '2020-08-01'],
  ['HESA_ETHNIC', '31', 'Asian – Indian', '2020-08-01'],
  ['HESA_ETHNIC', '32', 'Asian – Pakistani', '2020-08-01'],
  ['HESA_ETHNIC', '33', 'Asian – Bangladeshi', '2020-08-01'],
  ['HESA_ETHNIC', '34', 'Asian – Chinese', '2020-08-01'],
  ['HESA_ETHNIC', '39', 'Asian – Other', '2020-08-01'],
  ['HESA_ETHNIC', '41', 'Black – African', '2020-08-01'],
  ['HESA_ETHNIC', '42', 'Black – Caribbean', '2020-08-01'],
  ['HESA_ETHNIC', '49', 'Black – Other', '2020-08-01'],
  ['HESA_ETHNIC', '50', 'Other ethnic background – Arab', '2020-08-01'],
  ['HESA_ETHNIC', '80', 'Other ethnic background', '2020-08-01'],
  ['HESA_ETHNIC', '90', 'Not known', '2020-08-01'],
  ['HESA_ETHNIC', '98', 'Information refused', '2020-08-01'],
  ['HESA_DISABLE', '00', 'No disability declared', '2020-08-01'],
  ['HESA_DISABLE', '53', 'Mental health condition', '2020-08-01'],
  ['HESA_DISABLE', '54', 'Specific learning difficulty', '2020-08-01'],
  ['HESA_DISABLE', '55', 'Long-term illness or health condition', '2020-08-01'],
  ['HESA_DISABLE', '56', 'Physical impairment or mobility issue', '2020-08-01'],
  ['HESA_DISABLE', '57', 'Sensory disability', '2020-08-01'],
  ['HESA_DISABLE', '58', 'Social/communication impairment (incl. ASD)', '2020-08-01'],
  ['HESA_DISABLE', '96', 'Two or more impairments', '2020-08-01'],
  ['HESA_DISABLE', '98', 'Information refused', '2020-08-01'],
  ['HESA_DISABLE', '99', 'Disability not listed above', '2020-08-01'],
];

export async function generate(ctx) {
  const models = modelsByDomain().get(domain);
  ctx.declareAll(models);
  const now = new Date('2026-05-17T08:00:00Z').toISOString();
  const audit = (date) => ctx.audit(date ?? now);

  // 1. Academic years (2020/21 .. 2026/27)
  const years = ACADEMIC_YEARS.map((label) => {
    const startDate = new Date(ayStartDate(label) + 'T00:00:00Z').toISOString();
    const endDate = new Date(ayEndDate(label) + 'T23:59:59Z').toISOString();
    const teachStartDate = startDate;
    const teachEndDate = new Date(ayEndDate(label) + 'T00:00:00Z');
    teachEndDate.setUTCMonth(teachEndDate.getUTCMonth() - 2);
    const id = `ay-${label.replace('/', '-')}`;
    ctx.ids.academicYears.push({ id, label, startDate, endDate, isCurrent: label === CURRENT_ACTIVE_YEAR });
    ctx.ids.academicYearIdByLabel.set(label, id);
    return {
      id, ...audit(), year: label, startDate, endDate,
      teachingStartDate: teachStartDate, teachingEndDate: teachEndDate.toISOString(),
      isActive: label === CURRENT_ACTIVE_YEAR,
    };
  });
  ctx.append('AcademicYear', years);

  // 2. HESA cost centres
  const ccs = HESA_COST_CENTRES.map(([code, name, groupCode, groupName]) => {
    const id = `cc-${code}`;
    ctx.ids.hesaCostCentres.push({ id, code, name });
    return {
      id, createdAt: now, updatedAt: now,
      code, name, groupCode, groupName, isActive: true,
      validFrom: '2020-08-01T00:00:00Z', validTo: null,
    };
  });
  ctx.append('HesaCostCentre', ccs);

  // 3. HECOS codes
  ctx.append('HesaHecosCode', HECOS_CODES.map(([code, name]) => ({
    id: `hecos-${code}`, createdAt: now, updatedAt: now,
    code, name, cahLevel1: null, cahLevel1Name: null,
    cahLevel2: null, cahLevel2Name: null, cahLevel3: null, cahLevel3Name: null,
    jacsCode: null, isActive: true,
    validFrom: '2020-08-01T00:00:00Z', validTo: null,
  })));

  // 4. SOC codes
  ctx.append('HesaSocCode', SOC_CODES.map(([code, description, majorGroup]) => ({
    id: `soc-${code}`,
    code, description, majorGroup,
    subMajorGroup: code.slice(0, 2), minorGroup: code.slice(0, 3), isActive: true,
  })));

  // 5. Qualification aims
  ctx.append('HesaQualificationAim', QUALIFICATION_AIMS.map(([code, name, fheq, category]) => ({
    id: `qa-${code}`, createdAt: now, updatedAt: now,
    code, name, fheqLevel: fheq, category, isActive: true,
  })));

  // 6. Staff contract levels
  ctx.append('HesaStaffContractLevel', STAFF_CONTRACT_LEVELS.map(([code, title, isAcademic, order]) => ({
    id: `scl-${code}`, code, title, description: title,
    isAcademic, seniorityOrder: order,
  })));

  // 7. Reason for ending
  ctx.append('HesaReasonForEndingLookup', REASONS_FOR_ENDING.map(([code, description, category]) => ({
    id: `rfe-${code}`, code, description, category, isActive: true,
  })));

  // 8. Coding frames
  ctx.append('HesaCodingFrame', CODING_FRAMES.map(([codingType, code, description, validFrom]) => ({
    id: `cf-${codingType}-${code}`, ...audit(),
    codingType, code, description,
    validFrom: validFrom + 'T00:00:00Z', validTo: null,
  })));

  // 9. Coding frame versions (one per major coding type)
  ctx.append('HesaCodingFrameVersion', [
    ['HESA_ETHNIC', 'v2020.1', '2020-08-01'],
    ['HESA_DISABLE', 'v2022.1', '2022-08-01'],
    ['HESA_QUAL', 'v2023.1', '2023-08-01'],
  ].map(([codingType, version, effectiveFrom]) => ({
    id: `cfv-${codingType}-${version}`, ...audit(),
    codingType, version,
    effectiveFrom: effectiveFrom + 'T00:00:00Z', effectiveTo: null,
    totalCodes: 0, changesSummary: 'Initial seed', sourceUrl: 'https://codingmanual.hesa.ac.uk',
  })));

  // 10. Quality rules
  ctx.append('HesaQualityRule', QUALITY_RULES.map(([ruleCode, ruleName, description, severity]) => ({
    id: `qr-${ruleCode}`, ...audit(),
    ruleCode, ruleName, ruleDescription: description, severity,
  })));

  // 11. Document templates
  ctx.append('DocumentTemplate', DOCUMENT_TEMPLATES.map(([templateType, format, name], i) => ({
    id: `doctpl-${templateType.toLowerCase()}`,
    createdAt: now, updatedAt: now, createdBy: ctx.seedActor, updatedBy: 'system',
    deletedAt: null,
    name, templateType, format,
    templateHtml: `<html><body><h1>${name}</h1><p>{{recipient_name}}</p></body></html>`,
    variables: ['recipient_name', 'institution_name', 'today'],
    headerHtml: null, footerHtml: null, institutionLogo: null,
    lastModified: now,
  })));

  // 12. Communication templates
  ctx.append('CommunicationTemplate', COMMUNICATION_TEMPLATES.map(([templateType, channel, name]) => ({
    id: `commtpl-${templateType.toLowerCase()}`, ...audit(),
    name, templateType,
  })));

  ctx.log(domain, `${years.length} AYs, ${ccs.length} cost centres, ${HECOS_CODES.length} HECOS codes, ${SOC_CODES.length} SOC codes, ${QUALITY_RULES.length} quality rules`);
}
