import { describe, it, expect } from 'vitest';
import {
  composeHesaReturn,
  evaluateRule,
  type HesaStudentForReturn,
  type HesaModuleForReturn,
  type ProgrammeForReturn,
  type HesaValidationRuleForReturn,
} from '../../utils/hesa-return-composition';

const fixedDate = new Date('2026-01-15T09:00:00Z');

const baseStudent = (overrides: Partial<HesaStudentForReturn> = {}): HesaStudentForReturn => ({
  id: 'hs-1',
  studentId: 'stu-1',
  husid: '202500001',
  ownstu: 'STU-001',
  ttaccom: '01',
  disable: '00',
  ethnic: '15',
  sexort: '01',
  relblf: '02',
  genderid: '10',
  nation: 'GB',
  domicile: 'XF',
  socClass: '1',
  sec: '1.1',
  postcode: 'SW1A 1AA',
  comdate: '2025-09-01',
  enddate: null,
  hesaData: null,
  ...overrides,
});

const baseModule = (overrides: Partial<HesaModuleForReturn> = {}): HesaModuleForReturn => ({
  id: 'hm-1',
  moduleId: 'mod-1',
  academicYear: '2025/26',
  modId: 'CS101-2025',
  crdtPts: 30,
  crdtScm: 'ENG',
  levlpts: '4',
  fte: 0.25,
  pcolab: 0,
  hesaData: null,
  ...overrides,
});

const baseProgramme = (overrides: Partial<ProgrammeForReturn> = {}): ProgrammeForReturn => ({
  id: 'prog-1',
  programmeCode: 'BSC-CS-001',
  title: 'BSc Computer Science',
  level: 'LEVEL_6',
  awardingBody: 'Future Horizons Education',
  ...overrides,
});

const baseRule = (overrides: Partial<HesaValidationRuleForReturn> = {}): HesaValidationRuleForReturn => ({
  id: 'rule-1',
  ruleCode: 'HESA-STD-001',
  description: 'HUSID is required',
  entityType: 'HESAStudent',
  fieldName: 'HUSID',
  validationType: 'REQUIRED',
  expectedValues: null,
  severity: 'ERROR',
  isActive: true,
  ...overrides,
});

describe('composeHesaReturn (pure)', () => {
  it('returns an empty STUDENT body with a diagnostic note when no students supplied', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [],
      modules: [],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines).toEqual([]);
    expect(result.totals.recordCount).toBe(0);
    expect(result.notes.some((n) => n.includes('No HESAStudent rows in cohort'))).toBe(true);
  });

  it('renders a single-student STUDENT happy path with deterministic ordering', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: '202500001' })],
      modules: [],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.recordKey).toBe('202500001');
    expect(result.lines[0]?.entityType).toBe('HESAStudent');
    expect(result.lines[0]?.fields.HUSID).toBe('202500001');
    expect(result.totals.recordCount).toBe(1);
  });

  it('orders students by husid ascending for determinism', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [
        baseStudent({ id: 'hs-c', husid: '202500003' }),
        baseStudent({ id: 'hs-a', husid: '202500001' }),
        baseStudent({ id: 'hs-b', husid: '202500002' }),
      ],
      modules: [],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines.map((l) => l.recordKey)).toEqual([
      '202500001',
      '202500002',
      '202500003',
    ]);
  });

  it('captures a REQUIRED rule failure when HUSID is missing', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: null })],
      modules: [],
      programmes: [],
      validationRules: [baseRule()],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.totals.errorCount).toBe(1);
    const failure = result.validationResults.find((v) => !v.passed);
    expect(failure?.ruleCode).toBe('HESA-STD-001');
    expect(failure?.severity).toBe('ERROR');
    expect(failure?.fieldName).toBe('HUSID');
  });

  it('passes a REQUIRED rule when the field is present', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: '202500001' })],
      modules: [],
      programmes: [],
      validationRules: [baseRule()],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.totals.errorCount).toBe(0);
    expect(result.validationResults.every((v) => v.passed)).toBe(true);
  });

  it('captures a CODE_LIST rule failure when value is not in allowed set', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ ethnic: '99' })],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-002',
          fieldName: 'ETHNIC',
          validationType: 'CODE_LIST',
          expectedValues: ['10', '15', '20'],
          severity: 'WARNING',
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.totals.warningCount).toBe(1);
    expect(result.totals.errorCount).toBe(0);
    expect(result.validationResults[0]?.passed).toBe(false);
  });

  it('REGEX rule passes for matching values and fails otherwise', () => {
    const pass = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: '202500001' })],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-003',
          fieldName: 'HUSID',
          validationType: 'REGEX',
          expectedValues: { pattern: '^\\d{9}$' },
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(pass.totals.errorCount).toBe(0);

    const fail = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: 'short' })],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-003',
          fieldName: 'HUSID',
          validationType: 'REGEX',
          expectedValues: { pattern: '^\\d{9}$' },
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(fail.totals.errorCount).toBe(1);
  });

  it('REGEX rule accepts [0-9]{n} anchored patterns', () => {
    const line = {
      recordKey: '202500001',
      entityType: 'HESAStudent' as const,
      entityId: 'hs-1',
      fields: { HUSID: '202500001' },
      sortOrder: 0,
    };
    const result = evaluateRule(
      baseRule({
        validationType: 'REGEX',
        fieldName: 'HUSID',
        expectedValues: { pattern: '^[0-9]{9}$' },
      }),
      line,
    );
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('ERROR');
  });

  it('REGEX rule skips unsupported pattern shapes with INFO', () => {
    const line = {
      recordKey: 'x',
      entityType: 'HESAStudent' as const,
      entityId: 'hs-1',
      fields: { HUSID: '202500001' },
      sortOrder: 0,
    };
    const result = evaluateRule(
      baseRule({
        validationType: 'REGEX',
        fieldName: 'HUSID',
        expectedValues: { pattern: '^[A-Z]+$' },
      }),
      line,
    );
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('INFO');
    expect(result.message).toContain('not a supported anchored digit pattern');
  });

  it('REGEX rule skips when field value exceeds the input bound', () => {
    const longValue = '1'.repeat(4097);
    const line = {
      recordKey: 'x',
      entityType: 'HESAStudent' as const,
      entityId: 'hs-1',
      fields: { HUSID: longValue },
      sortOrder: 0,
    };
    const result = evaluateRule(
      baseRule({
        validationType: 'REGEX',
        fieldName: 'HUSID',
        expectedValues: { pattern: '^\\d{9}$' },
      }),
      line,
    );
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('INFO');
    expect(result.message).toContain('4096');
  });

  it('LENGTH rule honours min/max/eq', () => {
    const eq = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ postcode: 'SW1A 1AA' })],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-004',
          fieldName: 'POSTCODE',
          validationType: 'LENGTH',
          expectedValues: { eq: 8 },
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(eq.validationResults[0]?.passed).toBe(true);

    const tooLong = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ postcode: 'TOO LONG POSTCODE' })],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-004',
          fieldName: 'POSTCODE',
          validationType: 'LENGTH',
          expectedValues: { max: 8 },
          severity: 'WARNING',
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(tooLong.totals.warningCount).toBe(1);
  });

  it('skips inactive validation rules', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: null })],
      modules: [],
      programmes: [],
      validationRules: [baseRule({ isActive: false })],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.validationResults).toHaveLength(0);
    expect(result.totals.errorCount).toBe(0);
  });

  it('records a note when no rules are active', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent()],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({ ruleCode: 'A', isActive: false }),
        baseRule({ ruleCode: 'B', isActive: false }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.notes.some((n) => n.includes('All validation rules are inactive'))).toBe(true);
  });

  it('skips a rule whose entityType does not match the line entityType', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent({ husid: null })],
      modules: [],
      programmes: [],
      validationRules: [baseRule({ entityType: 'HESAModule' })],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.validationResults).toHaveLength(0);
  });

  it('skips an unknown validationType with a diagnostic INFO entry', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent()],
      modules: [],
      programmes: [],
      validationRules: [
        baseRule({
          ruleCode: 'HESA-STD-X',
          validationType: 'NEVER_HEARD_OF_THIS',
        }),
      ],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.validationResults).toHaveLength(1);
    expect(result.validationResults[0]?.passed).toBe(true);
    expect(result.validationResults[0]?.message).toContain('Skipped');
    expect(result.totals.skippedRuleCount).toBe(1);
  });

  it('renders MODULE return with preliminary note', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'MODULE',
      students: [],
      modules: [baseModule()],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.entityType).toBe('HESAModule');
    expect(result.notes.some((n) => n.includes('preliminary'))).toBe(true);
  });

  it('DATA_FUTURES return combines students, modules, and programmes', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'DATA_FUTURES',
      students: [baseStudent()],
      modules: [baseModule()],
      programmes: [baseProgramme()],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines).toHaveLength(3);
    expect(result.totals.recordCount).toBe(3);
    const types = result.lines.map((l) => l.entityType);
    expect(types).toContain('HESAStudent');
    expect(types).toContain('HESAModule');
    expect(types).toContain('Programme');
  });

  it('DATA_FUTURES with no rows emits an empty-cohort note', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'DATA_FUTURES',
      students: [],
      modules: [],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'user-1',
    });
    expect(result.lines).toHaveLength(0);
    expect(result.notes.some((n) => n.includes('contains no rows'))).toBe(true);
  });

  it('header captures generatedDate, generatedBy, and column ordering', () => {
    const result = composeHesaReturn({
      academicYear: '2025/26',
      returnType: 'STUDENT',
      students: [baseStudent()],
      modules: [],
      programmes: [],
      validationRules: [],
      generatedDate: fixedDate,
      generatedBy: 'sub-123',
    });
    expect(result.header.academicYear).toBe('2025/26');
    expect(result.header.returnType).toBe('STUDENT');
    expect(result.header.generatedDate).toBe(fixedDate);
    expect(result.header.generatedBy).toBe('sub-123');
    expect(result.header.columnOrder.length).toBeGreaterThan(0);
    expect(result.header.columnOrder).toContain('HUSID');
  });
});
