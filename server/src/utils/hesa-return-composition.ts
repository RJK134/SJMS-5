/**
 * Workstream C2 — HESA return composition pure utility (first cut).
 *
 * Given a snapshot of HESAStudent rows, HESAModule rows, the cohort of
 * Programmes those students are on, and the active HESAValidationRule
 * set, returns a structured payload representing a HESA Data Futures
 * return envelope: header / lines (per-student) / validation results /
 * totals.
 *
 * Pure — no Prisma, no file system, no network, no XML rendering. The
 * companion service layer (`hesa.service::composeReturn`) loads the
 * inputs and persists the outputs through HESASnapshot and HESAReturn.
 *
 * Validation rules execute against each line: each rule is interpreted
 * as `{entityType, fieldName, validationType, expectedValues, severity}`.
 * Supported validationTypes for the first cut:
 *   - REQUIRED        — fieldName must have a non-null, non-empty value
 *   - CODE_LIST       — fieldName value must appear in expectedValues
 *   - REGEX           — fieldName must match the regex in expectedValues.pattern
 *                       — ONLY anchored digit patterns are accepted, see
 *                         SUPPORTED_DIGIT_PATTERN below; everything else is
 *                         INFO/Skipped.
 *   - LENGTH          — fieldName length must equal / fall within expectedValues
 *
 * A rule that cannot be evaluated (e.g. unknown validationType) is
 * reported with severity INFO and a "skipped" reason rather than
 * failing the return — it is honest and operators can triage.
 */

/** Schema-compatible HESA return type. */
export type HesaReturnType = 'STUDENT' | 'COURSE' | 'MODULE' | 'STAFF' | 'DATA_FUTURES';

/** Schema-compatible validation severity. */
export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

/** HESAStudent projection consumed by the composer. */
export interface HesaStudentForReturn {
  id: string;
  studentId: string;
  husid: string | null;
  ownstu: string | null;
  ttaccom: string | null;
  disable: string | null;
  ethnic: string | null;
  sexort: string | null;
  relblf: string | null;
  genderid: string | null;
  nation: string | null;
  domicile: string | null;
  socClass: string | null;
  sec: string | null;
  postcode: string | null;
  comdate: string | null;
  enddate: string | null;
  /** Free-form additional Data Futures data — projected verbatim. */
  hesaData: Record<string, unknown> | null;
}

/** HESAModule projection consumed by the composer. */
export interface HesaModuleForReturn {
  id: string;
  moduleId: string;
  academicYear: string;
  modId: string | null;
  crdtPts: number | null;
  crdtScm: string | null;
  levlpts: string | null;
  fte: number | null;
  pcolab: number | null;
  hesaData: Record<string, unknown> | null;
}

/** Programme projection. */
export interface ProgrammeForReturn {
  id: string;
  programmeCode: string;
  title: string;
  level: string;
  awardingBody: string;
}

/** HESAValidationRule projection. */
export interface HesaValidationRuleForReturn {
  id: string;
  ruleCode: string;
  description: string;
  entityType: string;
  fieldName: string;
  validationType: string;
  expectedValues: unknown;
  severity: ValidationSeverity;
  isActive: boolean;
}

/** Inputs to the composer. */
export interface ComposeHesaReturnInput {
  academicYear: string;
  returnType: HesaReturnType;
  students: ReadonlyArray<HesaStudentForReturn>;
  modules: ReadonlyArray<HesaModuleForReturn>;
  programmes: ReadonlyArray<ProgrammeForReturn>;
  validationRules: ReadonlyArray<HesaValidationRuleForReturn>;
  /** When generated; defaults to "now" but the caller can pass a deterministic value for testing. */
  generatedDate: Date;
  /** Operator id (Keycloak sub) who composed the return. */
  generatedBy: string;
}

/** A single HESA return line — one record in the submitted envelope. */
export interface HesaReturnLine {
  /** Stable record key (e.g. HUSID, programme code, module code). */
  recordKey: string;
  /** Source entity type — STUDENT / COURSE / MODULE. */
  entityType: 'HESAStudent' | 'Programme' | 'HESAModule';
  /** Source entity ID for traceability. */
  entityId: string;
  /** Flattened HESA-shape fields ready for export. */
  fields: Record<string, unknown>;
  /** Stable ordering key — recordKey ascending. */
  sortOrder: number;
}

/** Validation finding — a single rule-vs-row outcome. */
export interface ValidationResult {
  ruleCode: string;
  ruleId: string;
  description: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  severity: ValidationSeverity;
  passed: boolean;
  message: string;
}

/** Outcome returned by the composer. */
export interface HesaReturnComposition {
  /** Header — printed at the top of the return envelope. */
  header: {
    academicYear: string;
    returnType: HesaReturnType;
    generatedDate: Date;
    generatedBy: string;
    /** Standard column ordering for CSV / XML rendering — first cut. */
    columnOrder: string[];
  };
  /** All return lines, ordered by recordKey ascending for determinism. */
  lines: HesaReturnLine[];
  /** Outcome of every executed validation rule against every line. */
  validationResults: ValidationResult[];
  /** Counts by severity and overall record count. */
  totals: {
    recordCount: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    skippedRuleCount: number;
  };
  /** Diagnostic notes — empty for a fully clean composition. */
  notes: string[];
}

// ── Internal helpers ─────────────────────────────────────────────────────

const STUDENT_COLUMN_ORDER = [
  'HUSID',
  'OWNSTU',
  'ETHNIC',
  'DISABLE',
  'SEXORT',
  'RELBLF',
  'GENDERID',
  'NATION',
  'DOMICILE',
  'SOCCLASS',
  'SEC',
  'POSTCODE',
  'TTACCOM',
  'COMDATE',
  'ENDDATE',
] as const;

const MODULE_COLUMN_ORDER = [
  'MODID',
  'MODULE_CODE',
  'ACADEMIC_YEAR',
  'CRDTPTS',
  'CRDTSCM',
  'LEVLPTS',
  'FTE',
  'PCOLAB',
] as const;

const COURSE_COLUMN_ORDER = [
  'PROGRAMME_CODE',
  'TITLE',
  'LEVEL',
  'AWARDING_BODY',
  'ACADEMIC_YEAR',
] as const;

/**
 * REGEX validation — narrow allow-list approach.
 *
 * `HESAValidationRule.expectedValues.pattern` is authored by
 * COMPLIANCE-role users (not end users), but rather than dynamically
 * compile the user-supplied string into a `RegExp` (which CodeQL
 * `js/regex-injection` correctly flags as user-controlled, and which
 * could in principle host an accidental ReDoS pattern), we accept ONLY
 * a small canonical shape that covers every HESA validation rule we
 * actually need:
 *
 *   ^\d{N}$        — anchored digit pattern, N=1..n
 *   ^[0-9]{N}$     — same shape with explicit character class
 *
 * Anything else (free-form character classes, alternations, postcode
 * patterns, etc.) is reported as INFO/Skipped with the message "not a
 * supported anchored digit pattern". HESA rules that need other
 * shapes can be expressed as CODE_LIST or LENGTH instead.
 *
 * This is a recognised CodeQL sanitiser pattern: the value handed to
 * `RegExp` is constrained by a literal regex match against the
 * pattern source BEFORE construction, so the data flow is no longer
 * tainted into the RegExp constructor.
 *
 * The input length is also capped at MAX_REGEX_INPUT_LENGTH so even
 * the narrow set of allowed patterns cannot run against pathologically
 * long inputs.
 */
const SUPPORTED_DIGIT_PATTERN = /^\^(?:\\d|\[0-9\])\{(\d+)\}\$$/;
const MAX_REGEX_INPUT_LENGTH = 4096;

function flattenStudent(s: HesaStudentForReturn): Record<string, unknown> {
  return {
    HUSID: s.husid,
    OWNSTU: s.ownstu,
    ETHNIC: s.ethnic,
    DISABLE: s.disable,
    SEXORT: s.sexort,
    RELBLF: s.relblf,
    GENDERID: s.genderid,
    NATION: s.nation,
    DOMICILE: s.domicile,
    SOCCLASS: s.socClass,
    SEC: s.sec,
    POSTCODE: s.postcode,
    TTACCOM: s.ttaccom,
    COMDATE: s.comdate,
    ENDDATE: s.enddate,
  };
}

function flattenModule(m: HesaModuleForReturn): Record<string, unknown> {
  return {
    MODID: m.modId,
    MODULE_CODE: m.moduleId,
    ACADEMIC_YEAR: m.academicYear,
    CRDTPTS: m.crdtPts,
    CRDTSCM: m.crdtScm,
    LEVLPTS: m.levlpts,
    FTE: m.fte,
    PCOLAB: m.pcolab,
  };
}

function flattenProgramme(p: ProgrammeForReturn, academicYear: string): Record<string, unknown> {
  return {
    PROGRAMME_CODE: p.programmeCode,
    TITLE: p.title,
    LEVEL: p.level,
    AWARDING_BODY: p.awardingBody,
    ACADEMIC_YEAR: academicYear,
  };
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

/**
 * Evaluate a single validation rule against a single return line.
 * Exported so the service layer can re-run the same evaluator against
 * snapshot rows during `validateReturn` without rebuilding a full
 * compose input.
 */
export function evaluateRule(
  rule: HesaValidationRuleForReturn,
  line: HesaReturnLine,
): ValidationResult {
  const entityTypeMatch = rule.entityType === line.entityType;
  // The field name on the rule maps directly to the column key on the
  // flattened line. Rules registered against an entity type that this
  // line doesn't represent are silently passed (they don't apply).
  if (!entityTypeMatch) {
    return {
      ruleCode: rule.ruleCode,
      ruleId: rule.id,
      description: rule.description,
      entityType: line.entityType,
      entityId: line.entityId,
      fieldName: rule.fieldName,
      severity: rule.severity,
      passed: true,
      message: 'Rule entity type does not apply to this line.',
    };
  }

  const value = line.fields[rule.fieldName];

  switch (rule.validationType) {
    case 'REQUIRED': {
      const passed = !isEmpty(value);
      return {
        ruleCode: rule.ruleCode,
        ruleId: rule.id,
        description: rule.description,
        entityType: line.entityType,
        entityId: line.entityId,
        fieldName: rule.fieldName,
        severity: rule.severity,
        passed,
        message: passed
          ? 'Required field present.'
          : `Field ${rule.fieldName} is required but is missing or empty.`,
      };
    }
    case 'CODE_LIST': {
      const allowed = Array.isArray(rule.expectedValues)
        ? (rule.expectedValues as unknown[]).map(String)
        : [];
      // A null / empty value is reported as failed because a code-list
      // implies a present value. Operators use REQUIRED to control
      // null-ability separately.
      if (isEmpty(value)) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: rule.severity,
          passed: false,
          message: `Field ${rule.fieldName} is empty so code-list cannot apply.`,
        };
      }
      const passed = allowed.includes(String(value));
      return {
        ruleCode: rule.ruleCode,
        ruleId: rule.id,
        description: rule.description,
        entityType: line.entityType,
        entityId: line.entityId,
        fieldName: rule.fieldName,
        severity: rule.severity,
        passed,
        message: passed
          ? 'Value present in code list.'
          : `Value "${String(value)}" not in allowed code list (${allowed.length} codes).`,
      };
    }
    case 'REGEX': {
      const expected =
        typeof rule.expectedValues === 'object' && rule.expectedValues !== null
          ? (rule.expectedValues as { pattern?: unknown }).pattern
          : null;
      if (typeof expected !== 'string') {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: 'INFO',
          passed: true,
          message: 'Skipped — REGEX rule has no pattern in expectedValues.',
        };
      }
      // Narrow allow-list — only anchored digit patterns are accepted.
      // CodeQL js/regex-injection is satisfied because the value handed
      // to `RegExp` is constrained by a literal regex match BEFORE
      // construction; the user-controlled flow is sanitised.
      const match = SUPPORTED_DIGIT_PATTERN.exec(expected);
      if (!match) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: 'INFO',
          passed: true,
          message:
            'Skipped — not a supported anchored digit pattern. Use CODE_LIST or LENGTH for non-digit shapes.',
        };
      }
      if (isEmpty(value)) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: rule.severity,
          passed: false,
          message: `Field ${rule.fieldName} empty so regex cannot apply.`,
        };
      }
      // Defence in depth: input length cap. A ^\d{n}$ pattern is not a
      // ReDoS source by construction, but capping keeps the worst-case
      // work proportional to the rule even if a reviewer ever loosens
      // SUPPORTED_DIGIT_PATTERN.
      const candidate = String(value);
      if (candidate.length > MAX_REGEX_INPUT_LENGTH) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: 'INFO',
          passed: true,
          message: `Skipped — value length ${candidate.length} exceeds ${MAX_REGEX_INPUT_LENGTH} character bound.`,
        };
      }
      // Re-construct the regex from the matched digit count, NOT from
      // the user-controlled `expected` string. The data flow into
      // RegExp is therefore literal-controlled: the constant
      // `^\d{N}$` template plus a parsed integer.
      const digitCount = parseInt(match[1] ?? '0', 10);
      if (!Number.isFinite(digitCount) || digitCount <= 0 || digitCount > 64) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: 'INFO',
          passed: true,
          message: `Skipped — digit count ${digitCount} out of range (1–64).`,
        };
      }
      // CodeQL: `safe` is constructed from a constant template plus a
      // bounded integer; no user-controlled string flows in here.
      const safe = new RegExp(`^\\d{${digitCount}}$`);
      const passed = safe.test(candidate);
      return {
        ruleCode: rule.ruleCode,
        ruleId: rule.id,
        description: rule.description,
        entityType: line.entityType,
        entityId: line.entityId,
        fieldName: rule.fieldName,
        severity: rule.severity,
        passed,
        message: passed
          ? 'Regex match.'
          : `Value "${candidate}" does not match anchored digit pattern of length ${digitCount}.`,
      };
    }
    case 'LENGTH': {
      const expectedObj =
        typeof rule.expectedValues === 'object' && rule.expectedValues !== null
          ? (rule.expectedValues as { min?: unknown; max?: unknown; eq?: unknown })
          : {};
      if (isEmpty(value)) {
        return {
          ruleCode: rule.ruleCode,
          ruleId: rule.id,
          description: rule.description,
          entityType: line.entityType,
          entityId: line.entityId,
          fieldName: rule.fieldName,
          severity: rule.severity,
          passed: false,
          message: `Field ${rule.fieldName} empty so length cannot apply.`,
        };
      }
      const length = String(value).length;
      const eq = typeof expectedObj.eq === 'number' ? expectedObj.eq : null;
      const min = typeof expectedObj.min === 'number' ? expectedObj.min : null;
      const max = typeof expectedObj.max === 'number' ? expectedObj.max : null;
      let passed = true;
      let reason = 'Length within range.';
      if (eq !== null && length !== eq) {
        passed = false;
        reason = `Expected length ${eq}, got ${length}.`;
      } else if (min !== null && length < min) {
        passed = false;
        reason = `Length ${length} is below minimum ${min}.`;
      } else if (max !== null && length > max) {
        passed = false;
        reason = `Length ${length} exceeds maximum ${max}.`;
      }
      return {
        ruleCode: rule.ruleCode,
        ruleId: rule.id,
        description: rule.description,
        entityType: line.entityType,
        entityId: line.entityId,
        fieldName: rule.fieldName,
        severity: rule.severity,
        passed,
        message: passed ? reason : reason,
      };
    }
    default: {
      return {
        ruleCode: rule.ruleCode,
        ruleId: rule.id,
        description: rule.description,
        entityType: line.entityType,
        entityId: line.entityId,
        fieldName: rule.fieldName,
        severity: 'INFO',
        passed: true,
        message: `Skipped — unknown validationType "${rule.validationType}".`,
      };
    }
  }
}

/**
 * Compose a HESA return from the supplied inputs. Pure — does NOT
 * touch Prisma. Returns a structured payload that callers can render
 * (CSV / XML) or persist verbatim into HESASnapshot.snapshotData.
 */
export function composeHesaReturn(input: ComposeHesaReturnInput): HesaReturnComposition {
  const notes: string[] = [];

  // Build lines per return type. The order is recordKey ascending so
  // the output is deterministic across runs (regression-safe).
  const buildStudentLines = (): HesaReturnLine[] =>
    [...input.students]
      .sort((a, b) => {
        const aKey = a.husid ?? a.id;
        const bKey = b.husid ?? b.id;
        if (aKey === bKey) return 0;
        return aKey < bKey ? -1 : 1;
      })
      .map((s, i) => ({
        recordKey: s.husid ?? s.id,
        entityType: 'HESAStudent' as const,
        entityId: s.id,
        fields: flattenStudent(s),
        sortOrder: i,
      }));

  const buildModuleLines = (): HesaReturnLine[] =>
    [...input.modules]
      .sort((a, b) => {
        const aKey = a.modId ?? a.moduleId;
        const bKey = b.modId ?? b.moduleId;
        if (aKey === bKey) return 0;
        return aKey < bKey ? -1 : 1;
      })
      .map((m, i) => ({
        recordKey: m.modId ?? m.moduleId,
        entityType: 'HESAModule' as const,
        entityId: m.id,
        fields: flattenModule(m),
        sortOrder: i,
      }));

  const buildCourseLines = (): HesaReturnLine[] =>
    [...input.programmes]
      .sort((a, b) => {
        if (a.programmeCode === b.programmeCode) return 0;
        return a.programmeCode < b.programmeCode ? -1 : 1;
      })
      .map((p, i) => ({
        recordKey: p.programmeCode,
        entityType: 'Programme' as const,
        entityId: p.id,
        fields: flattenProgramme(p, input.academicYear),
        sortOrder: i,
      }));

  let lines: HesaReturnLine[];
  let columnOrder: string[];

  switch (input.returnType) {
    case 'STUDENT':
      lines = buildStudentLines();
      columnOrder = [...STUDENT_COLUMN_ORDER];
      if (lines.length === 0) {
        notes.push('No HESAStudent rows in cohort — return body is empty.');
      }
      break;
    case 'MODULE':
      lines = buildModuleLines();
      columnOrder = [...MODULE_COLUMN_ORDER];
      notes.push('MODULE return body is preliminary — Data Futures field mapping not finalised.');
      break;
    case 'COURSE':
      lines = buildCourseLines();
      columnOrder = [...COURSE_COLUMN_ORDER];
      notes.push('COURSE return body is preliminary — Data Futures field mapping not finalised.');
      break;
    case 'STAFF':
      lines = [];
      columnOrder = [];
      notes.push('STAFF return is not yet supported in this implementation.');
      break;
    case 'DATA_FUTURES':
      // Data Futures continuous mode combines student and module rows so
      // operators get the same shape as the full envelope but without
      // the seasonal cut-over. Programmes are also included for
      // completeness in this first cut.
      lines = [
        ...buildStudentLines(),
        ...buildModuleLines(),
        ...buildCourseLines(),
      ].map((l, i) => ({ ...l, sortOrder: i }));
      columnOrder = Array.from(
        new Set([
          ...STUDENT_COLUMN_ORDER,
          ...MODULE_COLUMN_ORDER,
          ...COURSE_COLUMN_ORDER,
        ]),
      );
      if (lines.length === 0) {
        notes.push('DATA_FUTURES return contains no rows — students, modules and programmes all empty.');
      }
      break;
    default: {
      // Defensive fallback — TypeScript should already prevent this.
      lines = [];
      columnOrder = [];
      notes.push(`Unsupported returnType "${String(input.returnType)}".`);
    }
  }

  // Run validation rules. Inactive rules are skipped — the validation
  // surface only re-evaluates rules an operator has chosen to enable.
  const activeRules = input.validationRules.filter((r) => r.isActive);
  if (input.validationRules.length > 0 && activeRules.length === 0) {
    notes.push('All validation rules are inactive — no validation was executed.');
  }

  const validationResults: ValidationResult[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let skippedRuleCount = 0;

  for (const rule of activeRules) {
    for (const line of lines) {
      const result = evaluateRule(rule, line);
      // Skip rules whose entityType is not the same as the line's
      // entity type — they did not really run, so we record them as
      // INFO/skipped if and only if no other rule applied to the line.
      // For a clean accounting, "not applicable" rule outcomes are
      // omitted entirely so the operator surface only reflects rules
      // that actually fired against a line.
      if (result.message === 'Rule entity type does not apply to this line.') {
        continue;
      }
      validationResults.push(result);
      if (result.passed && result.message.startsWith('Skipped')) {
        skippedRuleCount += 1;
        infoCount += 1;
      } else if (!result.passed) {
        if (result.severity === 'ERROR') errorCount += 1;
        else if (result.severity === 'WARNING') warningCount += 1;
        else infoCount += 1;
      }
    }
  }

  return {
    header: {
      academicYear: input.academicYear,
      returnType: input.returnType,
      generatedDate: input.generatedDate,
      generatedBy: input.generatedBy,
      columnOrder,
    },
    lines,
    validationResults,
    totals: {
      recordCount: lines.length,
      errorCount,
      warningCount,
      infoCount,
      skippedRuleCount,
    },
    notes,
  };
}
