import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import * as repo from '../../repositories/hesaNotification.repository';
import * as hesaReturnRepo from '../../repositories/hesaReturn.repository';
import * as hesaSnapshotRepo from '../../repositories/hesaSnapshot.repository';
import * as hesaValidationRuleRepo from '../../repositories/hesaValidationRule.repository';
import * as hesaStudentRepo from '../../repositories/hesaStudent.repository';
import * as hesaModuleRepo from '../../repositories/hesaModule.repository';
import * as programmeRepo from '../../repositories/programme.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  composeHesaReturn,
  evaluateRule,
  type ComposeHesaReturnInput,
  type HesaReturnComposition,
  type HesaReturnType,
  type HesaReturnLine,
  type HesaStudentForReturn,
  type HesaModuleForReturn,
  type ProgrammeForReturn,
  type HesaValidationRuleForReturn,
  type ValidationSeverity,
} from '../../utils/hesa-return-composition';
import { exportHesaReturnAsCsv } from '../../utils/hesa-csv-export';

// ── HESA notification queue (existing CRUD — unchanged) ─────────────────────

export interface HesaNotificationListQuery {
  cursor?: string;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
  entityType?: string;
  entityId?: string;
  status?: string;
}

export async function list(query: HesaNotificationListQuery) {
  const { cursor, limit, sort, order, entityType, entityId, status } = query;
  return repo.list(
    { entityType, entityId, status },
    { cursor, limit, sort, order },
  );
}

export async function getById(id: string) {
  const result = await repo.getById(id);
  if (!result) throw new NotFoundError('HESANotification', id);
  return result;
}

export async function create(data: Prisma.HESANotificationUncheckedCreateInput, userId: string, req: Request) {
  const result = await repo.create({ ...data, createdBy: userId });
  await logAudit('HESANotification', result.id, 'CREATE', userId, null, result, req);
  emitEvent({
    event: 'hesa.notification_queued',
    entityType: 'HESANotification',
    entityId: result.id,
    actorId: userId,
    data: {
      entityType: result.entityType,
      entityId: result.entityId,
      changeType: result.changeType,
      status: result.status,
    },
  });
  return result;
}

export async function update(id: string, data: Prisma.HESANotificationUpdateInput, userId: string, req: Request) {
  const previous = await getById(id);

  // Populate status timestamps on transitions
  const statusStr = typeof data.status === 'string' ? data.status : undefined;
  if (statusStr === 'SUBMITTED' && previous.status !== 'SUBMITTED') {
    data.submittedAt = new Date();
  }
  if ((statusStr === 'ACKNOWLEDGED' || statusStr === 'REJECTED') && previous.status !== statusStr) {
    data.acknowledgedAt = new Date();
  }

  const result = await repo.update(id, { ...data, updatedBy: userId });
  await logAudit('HESANotification', id, 'UPDATE', userId, previous, result, req);
  emitEvent({
    event: 'hesa.notification_updated',
    entityType: 'HESANotification',
    entityId: id,
    actorId: userId,
    data: {
      entityType: result.entityType,
      entityId: result.entityId,
      status: result.status,
      previousStatus: previous.status,
    },
  });
  return result;
}

export async function remove(id: string, userId: string, req: Request) {
  const previous = await getById(id);
  await repo.softDelete(id);
  await logAudit('HESANotification', id, 'DELETE', userId, previous, null, req);
  emitEvent({
    event: 'hesa.notification_deleted',
    entityType: 'HESANotification',
    entityId: id,
    actorId: userId,
    data: {
      entityType: previous.entityType,
      entityId: previous.entityId,
    },
  });
}

// ── Workstream C2 — HESA return composition (first cut) ─────────────────────
//
// composeReturn  — Loads HESAStudent / HESAModule / Programme rows for the
//                  cohort, transforms via the pure composer, persists a
//                  HESAReturn header + a HESASnapshot per record, and
//                  returns the structured payload.
// validateReturn — Re-runs the HESAValidationRule set against the most
//                  recent snapshot body of an existing HESAReturn and
//                  persists the validation outcome on the row.
// exportReturn   — Renders an existing HESAReturn body as CSV (XML is
//                  out of scope for the first cut).
//
// All three functions emit canonical webhooks and write AuditLog rows
// in the same shape as the rest of the platform. Service routes
// everything through repository helpers — no direct Prisma usage
// (Gate 4).

const SNAPSHOT_BODY_KEY = '__return_body__';

/** Options accepted by `composeReturn`. */
export interface ComposeReturnOptions {
  academicYear: string;
  returnType: HesaReturnType;
  /** Compose against an explicit return record (idempotent re-compose). */
  returnId?: string;
  /** Persist the composition as HESASnapshot rows. Defaults to true. */
  persist?: boolean;
  /** Bypass active-validation-rule scoping and use every rule. */
  includeInactiveRules?: boolean;
  /** Override the rule set entirely (used for previews / dry-runs). */
  ruleOverride?: HesaValidationRuleForReturn[];
  /** Override `now()` for deterministic testing. */
  generatedDate?: Date;
}

/** Outcome returned by `composeReturn`. */
export interface ComposeReturnResult {
  /** The composed return payload — caller can render directly. */
  composition: HesaReturnComposition;
  /** True iff a HESAReturn row was written or updated on this call. */
  persisted: boolean;
  /** HESAReturn row id (always set — composeReturn always allocates a header). */
  hesaReturnId: string;
  /** Number of HESASnapshot rows written this call. */
  snapshotCount: number;
  /** Diagnostic notes from the composer. */
  notes: string[];
}

/**
 * Coerce an HESAStudent row from Prisma into the projection the
 * composer expects. Dates are flattened to ISO date strings; Decimal
 * is rounded to a number; Json maps are kept as plain objects.
 */
function projectStudent(row: unknown): HesaStudentForReturn {
  const r = row as Record<string, unknown>;
  const dateOrNull = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') return v.slice(0, 10);
    return null;
  };
  const stringOrNull = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);
  const hesaData = r.hesaData;
  return {
    id: String(r.id),
    studentId: String(r.studentId ?? ''),
    husid: stringOrNull(r.husid),
    ownstu: stringOrNull(r.ownstu),
    ttaccom: stringOrNull(r.ttaccom),
    disable: stringOrNull(r.disable),
    ethnic: stringOrNull(r.ethnic),
    sexort: stringOrNull(r.sexort),
    relblf: stringOrNull(r.relblf),
    genderid: stringOrNull(r.genderid),
    nation: stringOrNull(r.nation),
    domicile: stringOrNull(r.domicile),
    socClass: stringOrNull(r.socClass),
    sec: stringOrNull(r.sec),
    postcode: stringOrNull(r.postcode),
    comdate: dateOrNull(r.comdate),
    enddate: dateOrNull(r.enddate),
    hesaData:
      hesaData && typeof hesaData === 'object' && !Array.isArray(hesaData)
        ? (hesaData as Record<string, unknown>)
        : null,
  };
}

function projectModule(row: unknown): HesaModuleForReturn {
  const r = row as Record<string, unknown>;
  const stringOrNull = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);
  const numberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof (v as { toNumber?: () => number }).toNumber === 'function') {
      try {
        return (v as { toNumber: () => number }).toNumber();
      } catch {
        return null;
      }
    }
    return null;
  };
  const hesaData = r.hesaData;
  return {
    id: String(r.id),
    moduleId: String(r.moduleId ?? ''),
    academicYear: String(r.academicYear ?? ''),
    modId: stringOrNull(r.modId),
    crdtPts: numberOrNull(r.crdtPts),
    crdtScm: stringOrNull(r.crdtScm),
    levlpts: stringOrNull(r.levlpts),
    fte: numberOrNull(r.fte),
    pcolab: numberOrNull(r.pcolab),
    hesaData:
      hesaData && typeof hesaData === 'object' && !Array.isArray(hesaData)
        ? (hesaData as Record<string, unknown>)
        : null,
  };
}

function projectProgramme(row: unknown): ProgrammeForReturn {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    programmeCode: String(r.programmeCode ?? ''),
    title: String(r.title ?? ''),
    level: String(r.level ?? ''),
    awardingBody: String(r.awardingBody ?? ''),
  };
}

function projectRule(row: unknown): HesaValidationRuleForReturn {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    ruleCode: String(r.ruleCode ?? ''),
    description: String(r.description ?? ''),
    entityType: String(r.entityType ?? ''),
    fieldName: String(r.fieldName ?? ''),
    validationType: String(r.validationType ?? ''),
    expectedValues: r.expectedValues ?? null,
    severity: (r.severity ?? 'ERROR') as ValidationSeverity,
    isActive: Boolean(r.isActive ?? true),
  };
}

/**
 * Compose a HESA return for a given (academicYear, returnType) pair.
 * Loads the cohort, runs the pure composer, persists the snapshot,
 * audits, emits webhook events.
 *
 * Idempotency:
 *   - When `returnId` is supplied, the existing HESAReturn is reused
 *     (recordCount/validationErrors/status are updated to reflect the
 *     fresh composition).
 *   - When `returnId` is absent, the most recent non-REJECTED return
 *     for the (academicYear, returnType) pair is reused; if none
 *     exists, a new HESAReturn row is created.
 *   - The HESASnapshot rows are atomically replaced on every compose
 *     call so the snapshot body always matches the most recent run.
 *
 * @throws ValidationError when persist=true but academicYear/returnType
 *   conflict with an explicitly-provided returnId.
 */
export async function composeReturn(
  options: ComposeReturnOptions,
  userId: string,
  req: Request,
): Promise<ComposeReturnResult> {
  const persist = options.persist !== false;
  const generatedDate = options.generatedDate ?? new Date();

  // Resolve / create the HESAReturn header.
  let hesaReturn: { id: string; academicYear: string; returnType: string; status: string } | null = null;
  if (options.returnId) {
    const existing = await hesaReturnRepo.getById(options.returnId);
    if (!existing) throw new NotFoundError('HESAReturn', options.returnId);
    if (existing.academicYear !== options.academicYear || existing.returnType !== options.returnType) {
      throw new ValidationError(
        `Return ${options.returnId} has academicYear=${existing.academicYear} returnType=${existing.returnType} ` +
          `but compose was called with ${options.academicYear} / ${options.returnType}.`,
      );
    }
    hesaReturn = {
      id: existing.id,
      academicYear: existing.academicYear,
      returnType: String(existing.returnType),
      status: String(existing.status),
    };
  } else if (persist) {
    const found = await hesaReturnRepo.findActiveByYear(options.academicYear, options.returnType);
    if (found) {
      hesaReturn = {
        id: found.id,
        academicYear: found.academicYear,
        returnType: String(found.returnType),
        status: String(found.status),
      };
    } else {
      const created = await hesaReturnRepo.create({
        academicYear: options.academicYear,
        returnType: options.returnType as Prisma.HESAReturnUncheckedCreateInput['returnType'],
        status: 'PREPARATION',
        recordCount: 0,
        createdBy: userId,
      });
      hesaReturn = {
        id: created.id,
        academicYear: created.academicYear,
        returnType: String(created.returnType),
        status: String(created.status),
      };
      await logAudit('HESAReturn', created.id, 'CREATE', userId, null, created, req);
      emitEvent({
        event: 'hesa.return_created',
        entityType: 'HESAReturn',
        entityId: created.id,
        actorId: userId,
        data: {
          academicYear: created.academicYear,
          returnType: created.returnType,
          status: created.status,
        },
      });
    }
  }

  // Load source cohort.
  const studentRows = await hesaStudentRepo.findActiveForAcademicYear(options.academicYear);
  const moduleRows = await hesaModuleRepo.findByAcademicYear(options.academicYear);
  // Programmes are scoped to the deletedAt:null active set.
  const programmesPage = await programmeRepo.list(
    {},
    { cursor: undefined, limit: 100, sort: 'programmeCode', order: 'asc' },
  );
  const programmeRows = (programmesPage as unknown as { data: unknown[] }).data ?? [];

  // Load validation rules.
  let ruleRows: unknown[];
  if (options.ruleOverride) {
    ruleRows = options.ruleOverride;
  } else if (options.includeInactiveRules) {
    const all = await hesaValidationRuleRepo.list(
      {},
      { cursor: undefined, limit: 500, sort: 'ruleCode', order: 'asc' },
    );
    ruleRows = (all as unknown as { data: unknown[] }).data ?? [];
  } else {
    ruleRows = await hesaValidationRuleRepo.findAllActive();
  }

  const composeInput: ComposeHesaReturnInput = {
    academicYear: options.academicYear,
    returnType: options.returnType,
    students: studentRows.map(projectStudent),
    modules: moduleRows.map(projectModule),
    programmes: programmeRows.map(projectProgramme),
    validationRules: ruleRows.map(projectRule),
    generatedDate,
    generatedBy: userId,
  };

  const composition = composeHesaReturn(composeInput);

  // Persist the snapshot body and update the HESAReturn header.
  let persisted = false;
  let snapshotCount = 0;
  let resolvedReturnId = hesaReturn?.id ?? '';

  if (persist && hesaReturn) {
    // Snapshot rows: one row per return line, plus a single
    // "__return_body__" row holding the composed envelope (header /
    // totals / validationResults / notes) so consumers can replay the
    // composition without re-running the load.
    const snapshotRows = [
      ...composition.lines.map((line) => ({
        entityType: line.entityType,
        entityId: line.entityId,
        snapshotData: {
          recordKey: line.recordKey,
          fields: line.fields,
          sortOrder: line.sortOrder,
        } as unknown as Prisma.InputJsonValue,
        snapshotDate: generatedDate,
        createdBy: userId,
      })),
      {
        entityType: 'HESAReturn',
        entityId: SNAPSHOT_BODY_KEY,
        snapshotData: {
          header: {
            academicYear: composition.header.academicYear,
            returnType: composition.header.returnType,
            generatedDate: composition.header.generatedDate.toISOString(),
            generatedBy: composition.header.generatedBy,
            columnOrder: composition.header.columnOrder,
          },
          totals: composition.totals,
          notes: composition.notes,
          validationResults: composition.validationResults,
        } as unknown as Prisma.InputJsonValue,
        snapshotDate: generatedDate,
        createdBy: userId,
      },
    ];

    snapshotCount = await hesaSnapshotRepo.replaceForReturn(hesaReturn.id, snapshotRows);

    // Update HESAReturn header to reflect the fresh composition.
    const updated = await hesaReturnRepo.update(hesaReturn.id, {
      recordCount: composition.totals.recordCount,
      validationErrors: composition.validationResults.filter((v) => !v.passed) as unknown as Prisma.InputJsonValue,
      status: 'PREPARATION',
      updatedBy: userId,
    });

    await logAudit('HESAReturn', hesaReturn.id, 'UPDATE', userId, hesaReturn, updated, req);
    persisted = true;
    resolvedReturnId = hesaReturn.id;

    emitEvent({
      event: 'hesa.snapshot_created',
      entityType: 'HESAReturn',
      entityId: hesaReturn.id,
      actorId: userId,
      data: {
        academicYear: hesaReturn.academicYear,
        returnType: hesaReturn.returnType,
        snapshotCount,
        recordCount: composition.totals.recordCount,
      },
    });
  } else if (persist) {
    // Should be unreachable — `persist=true` always allocates a header
    // above. Defensive only.
    throw new ValidationError('composeReturn could not allocate a HESAReturn header.');
  }

  emitEvent({
    event: 'hesa.return_composed',
    entityType: 'HESAReturn',
    entityId: resolvedReturnId || `${options.academicYear}/${options.returnType}`,
    actorId: userId,
    data: {
      academicYear: options.academicYear,
      returnType: options.returnType,
      recordCount: composition.totals.recordCount,
      errorCount: composition.totals.errorCount,
      warningCount: composition.totals.warningCount,
      infoCount: composition.totals.infoCount,
      persisted,
      snapshotCount,
      notes: composition.notes,
    },
  });

  return {
    composition,
    persisted,
    hesaReturnId: resolvedReturnId,
    snapshotCount,
    notes: composition.notes,
  };
}

// ── validateReturn ──────────────────────────────────────────────────────────

export interface ValidateReturnOptions {
  /** Bypass active-validation-rule scoping and use every rule. */
  includeInactiveRules?: boolean;
  /** Override the rule set entirely. */
  ruleOverride?: HesaValidationRuleForReturn[];
  /** Persist the validation outcome on HESAReturn.validationErrors + status. Defaults to true. */
  persist?: boolean;
}

export interface ValidateReturnResult {
  hesaReturnId: string;
  recordCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** When persist=true, the HESAReturn.status that was set. */
  status: string;
  validationResults: HesaReturnComposition['validationResults'];
}

/**
 * Re-run the validation rules against the most recent snapshot body
 * of an existing HESAReturn. Used after operators amend rules or
 * fix source data — the cohort doesn't need to be re-loaded if
 * nothing in the underlying student / module data has changed.
 *
 * The snapshot body is read directly from HESASnapshot rows (the
 * service guarantees one snapshot row per line, written during
 * `composeReturn`); the rule set is loaded separately so an operator
 * can adjust rules without recomposing.
 */
export async function validateReturn(
  returnId: string,
  options: ValidateReturnOptions,
  userId: string,
  req: Request,
): Promise<ValidateReturnResult> {
  const persist = options.persist !== false;
  const existing = await hesaReturnRepo.getById(returnId);
  if (!existing) throw new NotFoundError('HESAReturn', returnId);

  // Load the snapshot body — we only re-validate against rows the
  // composer wrote, not the live source.
  const snapshots = await hesaSnapshotRepo.findByReturnId(returnId);
  if (snapshots.length === 0) {
    throw new ValidationError(
      `HESAReturn ${returnId} has no snapshots — re-compose it via POST /v1/hesa/returns/compose first.`,
    );
  }

  // Reconstruct the lines from the per-row snapshots (skip the
  // "__return_body__" row which carries header/totals only).
  const lines = snapshots
    .filter((s) => s.entityId !== SNAPSHOT_BODY_KEY)
    .map((s) => {
      const data = s.snapshotData as { recordKey?: string; fields?: Record<string, unknown>; sortOrder?: number } | null;
      return {
        recordKey: data?.recordKey ?? s.entityId,
        entityType: s.entityType as 'HESAStudent' | 'Programme' | 'HESAModule',
        entityId: s.entityId,
        fields: data?.fields ?? {},
        sortOrder: data?.sortOrder ?? 0,
      };
    });

  // Rules.
  let ruleRows: unknown[];
  if (options.ruleOverride) {
    ruleRows = options.ruleOverride;
  } else if (options.includeInactiveRules) {
    const all = await hesaValidationRuleRepo.list(
      {},
      { cursor: undefined, limit: 500, sort: 'ruleCode', order: 'asc' },
    );
    ruleRows = (all as unknown as { data: unknown[] }).data ?? [];
  } else {
    ruleRows = await hesaValidationRuleRepo.findAllActive();
  }
  const rules = ruleRows.map(projectRule);

  // Re-run the pure evaluator against the snapshot rows directly.
  // The evaluator is exported from hesa-return-composition for this
  // exact reason — we don't need to round-trip through the composer's
  // "build from sources" path, which would otherwise risk substituting
  // sentinel record keys for the field values being checked.
  const validationResults: HesaReturnComposition['validationResults'] = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  // Filter rules: when `includeInactiveRules` is false (default) and
  // no explicit ruleOverride is supplied, only active rules apply.
  // Rule overrides bypass the active flag — the operator has chosen
  // the exact set to evaluate.
  const rulesToApply = options.ruleOverride
    ? rules
    : options.includeInactiveRules
      ? rules
      : rules.filter((r) => r.isActive);

  const lineForEvaluator: HesaReturnLine[] = lines.map((l) => ({
    recordKey: l.recordKey,
    entityType: l.entityType,
    entityId: l.entityId,
    fields: l.fields,
    sortOrder: l.sortOrder,
  }));

  for (const rule of rulesToApply) {
    for (const line of lineForEvaluator) {
      const result = evaluateRule(rule, line);
      // Skip the "rule does not apply" cases — they did not actually
      // run against the line's entityType.
      if (result.message === 'Rule entity type does not apply to this line.') continue;
      validationResults.push(result);
      if (!result.passed) {
        if (result.severity === 'ERROR') errorCount += 1;
        else if (result.severity === 'WARNING') warningCount += 1;
        else infoCount += 1;
      }
    }
  }

  // Persist the validation outcome on the HESAReturn header.
  let resolvedStatus = existing.status as string;
  if (persist) {
    const newStatus = errorCount > 0 ? 'VALIDATION' : 'VALIDATION';
    const updated = await hesaReturnRepo.update(returnId, {
      validationErrors: validationResults.filter((v) => !v.passed) as unknown as Prisma.InputJsonValue,
      status: newStatus as Prisma.HESAReturnUpdateInput['status'],
      updatedBy: userId,
    });
    resolvedStatus = String(updated.status);
    await logAudit('HESAReturn', returnId, 'UPDATE', userId, existing, updated, req);
  }

  emitEvent({
    event: 'hesa.return_validated',
    entityType: 'HESAReturn',
    entityId: returnId,
    actorId: userId,
    data: {
      academicYear: existing.academicYear,
      returnType: existing.returnType,
      recordCount: lines.length,
      errorCount,
      warningCount,
      infoCount,
      persisted: persist,
    },
  });

  return {
    hesaReturnId: returnId,
    recordCount: lines.length,
    errorCount,
    warningCount,
    infoCount,
    status: resolvedStatus,
    validationResults,
  };
}

// ── exportReturn ────────────────────────────────────────────────────────────

export type HesaExportFormat = 'csv';

export interface ExportReturnResult {
  hesaReturnId: string;
  format: HesaExportFormat;
  body: string;
  contentType: string;
  filename: string;
}

/**
 * Render a previously-composed HESAReturn body as a flat-file export.
 * The first cut supports CSV only; XML follows in a Phase 19
 * follow-up batch once the Data Futures schema mapping is finalised.
 */
export async function exportReturn(
  returnId: string,
  format: HesaExportFormat,
  userId: string,
  req: Request,
): Promise<ExportReturnResult> {
  const existing = await hesaReturnRepo.getById(returnId);
  if (!existing) throw new NotFoundError('HESAReturn', returnId);

  const snapshots = await hesaSnapshotRepo.findByReturnId(returnId);
  if (snapshots.length === 0) {
    throw new ValidationError(
      `HESAReturn ${returnId} has no snapshots — re-compose it via POST /v1/hesa/returns/compose first.`,
    );
  }

  // Pull the saved header / totals / validation block from the
  // sentinel snapshot row written by composeReturn.
  const bodySnapshot = snapshots.find((s) => s.entityId === SNAPSHOT_BODY_KEY);
  if (!bodySnapshot) {
    throw new ValidationError(
      `HESAReturn ${returnId} is missing its body snapshot — re-compose it before exporting.`,
    );
  }
  const body = bodySnapshot.snapshotData as {
    header?: {
      academicYear?: string;
      returnType?: string;
      generatedDate?: string;
      generatedBy?: string;
      columnOrder?: string[];
    };
    totals?: HesaReturnComposition['totals'];
    notes?: string[];
    validationResults?: HesaReturnComposition['validationResults'];
  };

  const lines = snapshots
    .filter((s) => s.entityId !== SNAPSHOT_BODY_KEY)
    .map((s) => {
      const data = s.snapshotData as { recordKey?: string; fields?: Record<string, unknown>; sortOrder?: number } | null;
      return {
        recordKey: data?.recordKey ?? s.entityId,
        entityType: s.entityType as 'HESAStudent' | 'Programme' | 'HESAModule',
        entityId: s.entityId,
        fields: data?.fields ?? {},
        sortOrder: data?.sortOrder ?? 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const composition: HesaReturnComposition = {
    header: {
      academicYear: body.header?.academicYear ?? existing.academicYear,
      returnType: (body.header?.returnType ?? existing.returnType) as HesaReturnType,
      generatedDate: body.header?.generatedDate ? new Date(body.header.generatedDate) : new Date(),
      generatedBy: body.header?.generatedBy ?? 'system',
      columnOrder: body.header?.columnOrder ?? [],
    },
    lines,
    validationResults: body.validationResults ?? [],
    totals: body.totals ?? {
      recordCount: lines.length,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      skippedRuleCount: 0,
    },
    notes: body.notes ?? [],
  };

  if (format !== 'csv') {
    throw new ValidationError(
      `HESA export format "${format}" is not supported; only "csv" is implemented in this batch (XML follows in a Phase 19 follow-up).`,
    );
  }

  const csv = exportHesaReturnAsCsv(composition);

  await logAudit(
    'HESAReturn',
    returnId,
    'EXPORT',
    userId,
    null,
    {
      format,
      recordCount: composition.totals.recordCount,
      errorCount: composition.totals.errorCount,
    } as Record<string, unknown>,
    req,
  );

  emitEvent({
    event: 'hesa.return_exported',
    entityType: 'HESAReturn',
    entityId: returnId,
    actorId: userId,
    data: {
      academicYear: existing.academicYear,
      returnType: existing.returnType,
      format,
      recordCount: composition.totals.recordCount,
    },
  });

  return {
    hesaReturnId: returnId,
    format,
    body: csv,
    contentType: 'text/csv; charset=utf-8',
    filename: `hesa-${existing.returnType}-${existing.academicYear.replace('/', '-')}-${returnId}.csv`,
  };
}
