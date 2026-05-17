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

export class GeneratorContext {
  constructor({ rng, outDir, schema, dryRun = false, scale = 1.0 }) {
    this.rng = rng;
    this.outDir = outDir;
    this.schema = schema;
    this.dryRun = dryRun;
    this.scale = scale;

    /** @type {Map<string, number>} table → rowCount */
    this.rowCounts = new Map();

    /** Shared id registries — generators publish ids here for downstream use. */
    this.ids = {
      tenantId: 'tenant-fhe-001',           // single-tenant; multi-tenancy is Phase 2 of SJMS-5
      academicYearIds: new Map(),           // label → id
      personIds: [],
      userIds: new Map(),                   // username → id
      facultyIds: new Map(),                // code → id
      departmentIds: new Map(),             // code → id
      campusIds: [],
      buildingIds: [],
      roomIds: [],
      staffIds: [],
      staffByDepartment: new Map(),
      programmeIds: [],
      moduleIds: [],
      moduleByDepartment: new Map(),
      applicantIds: [],
      studentIds: [],
      enrolmentIds: [],
      moduleRegistrationIds: [],
      assessmentIds: [],
      examinerIds: [],
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

  /** Write a data-bearing CSV. */
  async writeCsv(modelName, rows) {
    const columns = this.columnsForModel(modelName);
    const table = this.tableFor(modelName);
    if (this.dryRun) {
      this.rowCounts.set(table, rows.length);
      return { path: `(dry-run) ${table}.csv`, rowCount: rows.length };
    }
    const res = await writeCsv({ outDir: this.outDir, table, columns, rows });
    this.rowCounts.set(table, rows.length);
    return res;
  }

  /** Emit a headers-only CSV for a list of models. Used by D1 stubs. */
  async writeEmptyFor(modelNames) {
    for (const m of modelNames) await this.writeCsv(m, []);
  }

  log(domain, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write(`[${ts}] [${domain}] ${msg}\n`);
  }

  /** Scale a base row-count by ctx.scale (used by --scale CLI flag for CI samples). */
  scaled(n) {
    return Math.max(1, Math.round(n * this.scale));
  }
}

function toSnakeCase(s) {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
