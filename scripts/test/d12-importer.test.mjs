/**
 * D12 importer — live upsert pipeline.
 *
 * Tests the new D12 behaviour layered on top of the D11 scaffold:
 *   - classifyTables produces covered / skippedNoModel / skippedShape / skippedNoCsv lists.
 *   - upsertTableLive streams CSV -> coerce -> batched $transaction upserts.
 *   - emitAuditEvent writes one AuditLog row at the end.
 *   - CLI plan mode (no --persist) still works end-to-end.
 *   - FORBIDDEN_COLUMNS gate still fires.
 *
 * Live persistence is exercised against a stub Prisma client; an integration
 * test against a real Postgres belongs to Phase 0I where the full CI baseline
 * runs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyTables,
  upsertTableLive,
  emitAuditEvent,
  parseArgs,
} from '../import-sjms-dataset.mjs';
import { writeCsv } from '../sjms-data/lib/csv-writer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IMPORTER = path.join(REPO_ROOT, 'scripts', 'import-sjms-dataset.mjs');
const SJMS5_SCHEMA = path.join(REPO_ROOT, 'prisma', 'schema.prisma');

function run(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], {
      cwd: REPO_ROOT, env: { ...process.env, ...env },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`exit ${code}\n${err}\n--- stdout ---\n${out}`));
    });
  });
}

/**
 * Schema fixture matching a small slice of the real SJMS-5 schema.
 * Person (covered, full shape), DataLakeShim (no model — exists in dataset
 * but not in this schema), and a model whose CSV lacks a required field.
 */
function makeSchema() {
  return {
    models: new Map([
      ['Person', {
        tableMap: 'persons',
        fields: [
          { name: 'id', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: true, isUnique: false, defaultExpr: 'cuid()' },
          { name: 'createdAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
          { name: 'updatedAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
        ],
      }],
      ['Faculty', {
        tableMap: 'faculties',
        fields: [
          { name: 'id', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: true, isUnique: false, defaultExpr: 'cuid()' },
          { name: 'name', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: undefined },
          { name: 'establishedYear', type: 'Int', isEnum: false, isArray: false, isOptional: true, isId: false, isUnique: false, defaultExpr: undefined },
        ],
      }],
    ]),
    enums: new Set(),
  };
}

describe('parseArgs', () => {
  it('rejects --persist + --dry-run together', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseArgs(['--source', '/tmp', '--persist', '--dry-run']))
      .toThrow(/exit/);
    expect(err.mock.calls.flat().join('')).toMatch(/mutually exclusive/);
    exit.mockRestore();
    err.mockRestore();
  });

  it('requires --source', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => parseArgs([])).toThrow(/exit/);
    expect(err.mock.calls.flat().join('')).toMatch(/--source is required/);
    exit.mockRestore();
    err.mockRestore();
  });

  it('defaults batch to 500 and persist to false', () => {
    expect(parseArgs(['--source', '/tmp'])).toMatchObject({
      source: '/tmp', batch: 500, persist: false, dryRun: false,
    });
  });
});

describe('classifyTables', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'd12-classify-'));
    await writeCsv({
      outDir: dir, table: 'persons', columns: ['id', 'createdAt', 'updatedAt'],
      rows: [
        { id: 'p-1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') },
        { id: 'p-2', createdAt: new Date('2026-01-03'), updatedAt: new Date('2026-01-04') },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'faculties', columns: ['id', 'establishedYear'],
      rows: [{ id: 'fac-1', establishedYear: 1965 }],
    });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      generatorVersion: '0.1.0', seed: 'd12-test',
      generatedAt: '2026-05-18T00:00:00Z',
      schemaHash: 'fixture', schemaModels: 298, totalTables: 3,
      totalRows: 3,
      rowCounts: { persons: 2, faculties: 1, unknown_model: 5 },
    }, null, 2));
  });

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('lists models present in the schema with matching CSV as covered', async () => {
    const manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile(path.join(dir, 'manifest.json'), 'utf8'),
    );
    const c = await classifyTables(dir, manifest, makeSchema());
    const covered = c.covered.map((t) => t.table);
    expect(covered).toContain('persons');
  });

  it('lists models missing from the schema as skippedNoModel', async () => {
    const manifest = {
      schemaHash: 'fixture', schemaModels: 298, totalTables: 1, totalRows: 5,
      rowCounts: { persons: 0, faculties: 0 },
    };
    // Strip Person from schema to simulate a missing-model case.
    const schemaSansPerson = makeSchema();
    schemaSansPerson.models.delete('Person');
    const c = await classifyTables(dir, manifest, schemaSansPerson);
    expect(c.skippedNoModel.map((t) => t.datasetModel)).toContain('Person');
  });

  it('lists CSVs whose header lacks a required field as skippedShape', async () => {
    const manifest = {
      schemaHash: 'fixture', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { faculties: 1 },
    };
    // The CSV we wrote for faculties has columns [id, establishedYear].
    // Faculty model requires `name`, which is absent. Should be skippedShape.
    const c = await classifyTables(dir, manifest, makeSchema());
    const shape = c.skippedShape.find((t) => t.table === 'faculties');
    expect(shape).toBeDefined();
    expect(shape.missingRequired).toContain('name');
  });

  it('marks zero-row manifest entries as skippedNoCsv', async () => {
    const manifest = {
      schemaHash: 'fixture', schemaModels: 298, totalTables: 1, totalRows: 0,
      rowCounts: { persons: 0 },
    };
    const c = await classifyTables(dir, manifest, makeSchema());
    expect(c.skippedNoCsv.find((t) => t.datasetModel === 'Person')).toBeDefined();
    expect(c.covered.find((t) => t.datasetModel === 'Person')).toBeUndefined();
  });

  it('refuses snapshots containing FORBIDDEN_COLUMNS', async () => {
    const poisoned = await mkdtemp(path.join(tmpdir(), 'd12-poison-'));
    try {
      await writeFile(
        path.join(poisoned, 'persons.csv'),
        'id,createdAt,updatedAt,body\np-1,2026-01-01,2026-01-02,illegal\n',
        'utf8',
      );
      await writeFile(path.join(poisoned, 'manifest.json'), JSON.stringify({
        schemaHash: 'fixture', schemaModels: 298, totalTables: 1, totalRows: 1,
        rowCounts: { persons: 1 },
      }));
      const manifest = JSON.parse(
        await (await import('node:fs/promises')).readFile(path.join(poisoned, 'manifest.json'), 'utf8'),
      );
      await expect(classifyTables(poisoned, manifest, makeSchema()))
        .rejects.toThrow(/forbidden column "body"/);
    } finally {
      await rm(poisoned, { recursive: true, force: true });
    }
  });
});

describe('upsertTableLive', () => {
  let dir;
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'd12-upsert-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  function stubPrisma() {
    const calls = { upserts: [], transactions: [] };
    const personDelegate = {
      upsert: (args) => {
        const op = { delegate: 'person', op: 'upsert', args };
        calls.upserts.push(op);
        return op;
      },
    };
    const prisma = {
      person: personDelegate,
      $transaction: async (ops) => {
        calls.transactions.push(ops.length);
        return ops;
      },
    };
    return { prisma, calls };
  }

  it('streams a CSV through coerce -> $transaction batches', async () => {
    await writeCsv({
      outDir: dir, table: 'persons', columns: ['id', 'createdAt', 'updatedAt'],
      rows: Array.from({ length: 5 }, (_, n) => ({
        id: `p-${n}`,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      })),
    });
    const entry = {
      domain: 'identity',
      datasetModel: 'Person',
      table: 'persons',
      csvPath: path.join(dir, 'persons.csv'),
      manifestCount: 5,
      importableFields: makeSchema().models.get('Person').fields,
    };
    const { prisma, calls } = stubPrisma();
    const imported = await upsertTableLive(prisma, entry, 2);
    expect(imported).toBe(5);
    // batch 2, batch 2, batch 1 => 3 transactions, 5 upserts.
    expect(calls.transactions).toEqual([2, 2, 1]);
    expect(calls.upserts.length).toBe(5);
    // Spot-check the first upsert payload.
    expect(calls.upserts[0].args.where).toEqual({ id: 'p-0' });
    expect(calls.upserts[0].args.create.id).toBe('p-0');
    expect(calls.upserts[0].args.create.createdAt).toBeInstanceOf(Date);
  });

  it('throws if the Prisma client lacks a delegate for the model', async () => {
    await writeCsv({
      outDir: dir, table: 'persons2', columns: ['id', 'createdAt', 'updatedAt'],
      rows: [{ id: 'p-1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }],
    });
    const entry = {
      domain: 'identity',
      datasetModel: 'GhostModel',
      table: 'persons2',
      csvPath: path.join(dir, 'persons2.csv'),
      manifestCount: 1,
      importableFields: makeSchema().models.get('Person').fields,
    };
    const { prisma } = stubPrisma();
    await expect(upsertTableLive(prisma, entry, 100))
      .rejects.toThrow(/no delegate for model "GhostModel"/);
  });
});

describe('emitAuditEvent', () => {
  it('writes a single AuditLog row keyed to the manifest', async () => {
    const calls = [];
    const prisma = {
      auditLog: { create: async (args) => { calls.push(args); return args; } },
    };
    await emitAuditEvent(prisma, {
      generatedAt: '2026-05-18T00:00:00Z',
      seed: 'test', schemaHash: 'h', totalTables: 1, totalRows: 5,
    }, { persons: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0].data.entityType).toBe('Dataset');
    expect(calls[0].data.action).toBe('CREATE');
    expect(calls[0].data.entityId).toBe('2026-05-18T00:00:00Z');
    expect(calls[0].data.newData.importCounts).toEqual({ persons: 5 });
  });
});

describe('CLI plan mode (no --persist)', () => {
  let dir;
  // Person is required by the schema — write a CSV that satisfies all required
  // (no-default) Person fields: firstName, lastName, dateOfBirth.
  const PERSON_COLS = ['id', 'firstName', 'lastName', 'dateOfBirth', 'createdAt', 'updatedAt'];
  const PERSON_ROW = {
    id: 'p-1', firstName: 'Alice', lastName: 'Test',
    dateOfBirth: new Date('1990-01-01'),
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'd12-cli-'));
    await writeCsv({
      outDir: dir, table: 'persons', columns: PERSON_COLS, rows: [PERSON_ROW],
    });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      generatorVersion: '0.1.0', seed: 'cli-test',
      generatedAt: '2026-05-18T00:00:00Z',
      schemaHash: 'cli', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { persons: 1 },
    }));
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('exits 0 and reports a plan without opening a DB connection', async () => {
    const { out } = await run(IMPORTER, [
      '--source', dir, '--schema', SJMS5_SCHEMA, '--dry-run',
    ]);
    expect(out).toContain('Coverage report');
    expect(out).toMatch(/covered: +\d+ tables/);
    expect(out).toContain('PLAN:');
    expect(out).toContain('persons');
    expect(out).toContain('Scaffold complete');
  });

  it('FORBIDDEN_COLUMNS gate refuses a poisoned snapshot', async () => {
    const poisoned = await mkdtemp(path.join(tmpdir(), 'd12-cli-bad-'));
    try {
      await copyFile(
        path.join(dir, 'manifest.json'),
        path.join(poisoned, 'manifest.json'),
      );
      const poisonedCols = [...PERSON_COLS, 'body'];
      const poisonedHeader = poisonedCols.join(',');
      const poisonedRow = [
        PERSON_ROW.id, PERSON_ROW.firstName, PERSON_ROW.lastName,
        PERSON_ROW.dateOfBirth.toISOString(),
        PERSON_ROW.createdAt.toISOString(), PERSON_ROW.updatedAt.toISOString(),
        'illegal text',
      ].join(',');
      await writeFile(
        path.join(poisoned, 'persons.csv'),
        `${poisonedHeader}\n${poisonedRow}\n`,
        'utf8',
      );
      await expect(run(IMPORTER, [
        '--source', poisoned, '--schema', SJMS5_SCHEMA, '--dry-run',
      ])).rejects.toThrow(/forbidden column "body"/);
    } finally {
      await rm(poisoned, { recursive: true, force: true });
    }
  });
});
