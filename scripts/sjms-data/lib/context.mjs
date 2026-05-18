/**
 * Generator runtime context — streaming-write edition.
 *
 * Each ctx.append(model, rows) call writes rows directly to
 * <outDir>/<table>.csv. The first call per model opens the file (with
 * header row) and keeps the stream open; subsequent calls append rows.
 * flush() closes all streams.
 *
 * This avoids buffering 2-3 million row objects in memory (~2GB+), which
 * trips Node's default heap limit and gets the process OOM-killed.
 * Stream semantics preserve byte-identical determinism — same append
 * order = same output, just written incrementally.
 */

import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { columnsFor } from './schema.mjs';

const TENANT_ID = 'tenant-fhe-001';
const SEED_ACTOR = 'seed-script';

const FORBIDDEN_COLUMNS = new Set([
  'body', 'questionText', 'question_text', 'markScheme', 'mark_scheme',
  'answerKey', 'answer_key', 'answer', 'solution', 'solutionText', 'solution_text',
  'modelAnswer', 'model_answer', 'examPaperText', 'exam_paper_text',
]);

export class ForbiddenColumnError extends Error {
  constructor(table, column) {
    super(`Generator refused to write column "${column}" in table "${table}" — matches FORBIDDEN_COLUMNS rule.`);
    this.name = 'ForbiddenColumnError';
  }
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) value = JSON.stringify(value);
  else if (typeof value === 'object') value = JSON.stringify(value);
  else value = String(value);
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

class StreamSlot {
  constructor(table, columns, stream) {
    this.table = table;
    this.columns = columns;
    this.stream = stream;
    this.rowCount = 0;
    this.opened = false;
  }
  writeHeader() {
    this.stream.write(this.columns.join(',') + '\n');
    this.opened = true;
  }
  writeRow(row) {
    const line = this.columns.map((c) => escapeCell(row[c])).join(',');
    this.stream.write(line + '\n');
    this.rowCount += 1;
  }
  close() {
    return new Promise((resolve, reject) => {
      this.stream.end((err) => err ? reject(err) : resolve());
    });
  }
}

export class GeneratorContext {
  constructor({ rng, outDir, schema, dryRun = false, scale = 1.0 }) {
    this.rng = rng;
    this.outDir = outDir;
    this.schema = schema;
    this.dryRun = dryRun;
    this.scale = scale;
    this.tenantId = TENANT_ID;
    this.seedActor = SEED_ACTOR;

    /** @type {Map<string, StreamSlot>} */
    this._slots = new Map();
    /** @type {Map<string, number>} (table → rowCount) */
    this.rowCounts = new Map();

    /** Shared id registries — generators publish ids here for downstream use. */
    this.ids = {
      academicYears: [], academicYearIdByLabel: new Map(),
      campusIds: [], buildingIds: [], roomIds: [],
      facultyByCode: new Map(), departmentByCode: new Map(),
      hesaCostCentres: [],
      personIds: [],
      staffIds: [], staffByDepartment: new Map(), examinerIds: [],
      programmeIds: [], moduleIds: [], moduleByDepartment: new Map(),
      applicantIds: [],
      studentIds: [],
      enrolmentIds: [],
      moduleRegistrationIds: [],
      assessmentIds: [],
      sponsorIds: [], bursaryFundIds: [],
    };
  }

  columnsForModel(name) {
    const model = this.schema.models.get(name);
    if (!model) throw new Error(`Schema has no model "${name}"`);
    return columnsFor(model);
  }

  tableFor(name) {
    const model = this.schema.models.get(name);
    if (!model) throw new Error(`Schema has no model "${name}"`);
    return model.tableMap ?? toSnakeCase(name);
  }

  /** Open (or look up) the stream for a model. Writes the header on first open. */
  _slot(modelName) {
    if (!this._slots.has(modelName)) {
      const columns = this.columnsForModel(modelName);
      for (const c of columns) {
        if (FORBIDDEN_COLUMNS.has(c)) throw new ForbiddenColumnError(this.tableFor(modelName), c);
      }
      const table = this.tableFor(modelName);
      const stream = this.dryRun
        ? { write: () => {}, end: (cb) => cb && cb() }
        : createWriteStream(path.join(this.outDir, `${table}.csv`), 'utf8');
      const slot = new StreamSlot(table, columns, stream);
      slot.writeHeader();
      this._slots.set(modelName, slot);
    }
    return this._slots.get(modelName);
  }

  /** Append rows to the streaming CSV for a model. */
  append(modelName, rows) {
    if (!this.schema.models.has(modelName)) {
      throw new Error(`append(): schema has no model "${modelName}"`);
    }
    const slot = this._slot(modelName);
    if (rows && rows.length) {
      for (const row of rows) slot.writeRow(row);
    }
  }

  /** Declare a model — ensures the headers-only CSV is written even if no rows arrive. */
  declare(modelName) {
    this._slot(modelName);
  }

  declareAll(modelNames) {
    for (const m of modelNames) this.declare(m);
  }

  /** Close all streams and populate this.rowCounts. */
  async flush() {
    for (const [, slot] of this._slots) {
      this.rowCounts.set(slot.table, slot.rowCount);
      await slot.close();
    }
  }

  log(domain, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${ts}] [${domain}] ${msg}\n`);
  }

  scaled(n) {
    return Math.max(1, Math.round(n * this.scale));
  }

  audit(at) {
    const ts = at ?? new Date().toISOString();
    return {
      createdAt: ts, updatedAt: ts,
      createdBy: this.seedActor, updatedBy: this.seedActor,
      deletedAt: null,
    };
  }
}

function toSnakeCase(s) {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
