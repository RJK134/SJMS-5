/**
 * Generator runtime context.
 *
 * One instance per `generate()` run. Passed to every generator function
 * so generators can write CSVs without knowing about output paths or
 * other generators.
 *
 * The context is the seam between generators and the driver — generators
 * call ctx.writeCsv() / ctx.writeEmpty() / ctx.log() and the driver
 * collects results.
 */

import { writeCsv } from './csv-writer.mjs';
import { columnsFor } from './schema.mjs';

const TENANT_ID = 'tenant-fhe-001';   // single-tenant; multi-tenancy is Phase 2 of SJMS-5
const SEED_ACTOR = 'seed-script';     // populates createdBy / updatedBy audit columns

export class GeneratorContext {
  constructor({ rng, outDir, schema, dryRun = false, scale = 1.0 }) {
    this.rng = rng;
    this.outDir = outDir;
    this.schema = schema;
    this.dryRun = dryRun;
    this.scale = scale;
    this.tenantId = TENANT_ID;
    this.seedActor = SEED_ACTOR;

    /** @type {Map<string, object[]>} ModelName → buffered rows (drained at flush()) */
    this._buffers = new Map();

    /** @type {Map<string, number>} table → rowCount (set by flush()) */
    this.rowCounts = new Map();

    /** Shared id registries — generators publish ids here for downstream use. */
    this.ids = {
      academicYears: [],         // [{ id, label, startDate, endDate, isCurrent }]
      academicYearIdByLabel: new Map(),
      campusIds: [],
      buildingIds: [],
      roomIds: [],               // [{ id, type, buildingId, capacity, code }]
      facultyByCode: new Map(),  // code → { id, code, name }
      departmentByCode: new Map(),// code → { id, code, name, facultyCode, hecos }
      hesaCostCentres: [],       // [{ id, code, name }]
      personIds: [],             // generated persons across all generators
      staffIds: [],              // [{ id, personId, departmentId, role, category, gender }]
      staffByDepartment: new Map(),
      examinerIds: [],
      programmeIds: [],          // [{ id, code, departmentId, type, level, fheq }]
      moduleIds: [],             // [{ id, code, departmentId, credits, level }]
      moduleByDepartment: new Map(),
      applicantIds: [],          // [{ id, personId, programmeId, status, applicationId }]
      studentIds: [],            // [{ id, personId, programmeId, level, fee, mode }]
      enrolmentIds: [],          // [{ id, studentId, programmeId, academicYearId, status }]
      moduleRegistrationIds: [], // [{ id, enrolmentId, moduleId, academicYearId }]
      assessmentIds: [],         // [{ id, moduleId, type, weight }]
      sponsorIds: [],
      bursaryFundIds: [],
    };
  }

  /** Look up the canonical column list for a Prisma model. */
  columnsForModel(name) {
    const model = this.schema.models.get(name);
    if (!model) throw new Error(`Schema has no model "${name}"`);
    return columnsFor(model);
  }

  /** Map a Prisma model name to its `@@map(...)` table name (snake_case). */
  tableFor(name) {
    const model = this.schema.models.get(name);
    if (!model) throw new Error(`Schema has no model "${name}"`);
    return model.tableMap ?? toSnakeCase(name);
  }

  /**
   * Append rows to the buffered output for a model. Multiple generators can
   * contribute rows to the same model — they all land in <table>.csv at flush.
   *
   * Pass an empty array (or call `declare()`) to ensure the model's CSV gets
   * written even if no rows are produced — D1's stubs do this for every model.
   */
  append(modelName, rows) {
    if (!this.schema.models.has(modelName)) {
      throw new Error(`append(): schema has no model "${modelName}"`);
    }
    if (!this._buffers.has(modelName)) this._buffers.set(modelName, []);
    if (!rows || !rows.length) return;
    const buf = this._buffers.get(modelName);
    // push(...rows) overflows the stack for very large arrays (~600k+).
    // Chunk to keep argument list manageable.
    const CHUNK = 10_000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      buf.push.apply(buf, rows.slice(i, i + CHUNK));
    }
  }

  /** Declare that a model's CSV must be written (with at least the header row). */
  declare(modelName) {
    this.append(modelName, []);
  }

  /** Declare a list of models — convenience for stub generators. */
  declareAll(modelNames) {
    for (const m of modelNames) this.declare(m);
  }

  /** Flush all buffered rows to <outDir>/<table>.csv. Called once by the driver at the end. */
  async flush() {
    for (const [modelName, rows] of this._buffers) {
      const columns = this.columnsForModel(modelName);
      const table = this.tableFor(modelName);
      if (this.dryRun) {
        this.rowCounts.set(table, rows.length);
        continue;
      }
      await writeCsv({ outDir: this.outDir, table, columns, rows });
      this.rowCounts.set(table, rows.length);
    }
  }

  log(domain, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${ts}] [${domain}] ${msg}\n`);
  }

  /** Scale a base row-count by ctx.scale (used by --scale CLI flag for CI samples). */
  scaled(n) {
    return Math.max(1, Math.round(n * this.scale));
  }

  // ─── Common defaults every audited row gets ─────────────────────────────
  audit(at) {
    const ts = at ?? new Date().toISOString();
    return {
      createdAt: ts,
      updatedAt: ts,
      createdBy: this.seedActor,
      updatedBy: this.seedActor,
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
