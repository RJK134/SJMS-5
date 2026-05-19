/**
 * column-synthesisers — phase D0 follow-up.
 *
 * Tests:
 *   - synthesisableFields returns the right column set per SJMS-5 model
 *   - applySynthesisers fills missing columns from another column / lookup / stub
 *   - applySynthesisers leaves an existing CSV value intact (CSV value wins)
 *   - loadSynthContext reads academic_years.csv and person_names.csv
 *   - loadSynthContext tolerates missing files (returns empty maps)
 *   - classifyTables treats synthesisable columns as "available" for the
 *     shape check (a model whose CSV lacks a required column moves from
 *     skippedShape to covered when a synthesiser exists)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  COLUMN_SYNTHESISERS,
  synthesisableFields,
  applySynthesisers,
  loadSynthContext,
} from '../sjms-data/lib/column-synthesisers.mjs';
import { classifyTables } from '../import-sjms-dataset.mjs';
import { writeCsv } from '../sjms-data/lib/csv-writer.mjs';

describe('synthesisableFields', () => {
  it('returns the configured field set for a known model', () => {
    expect(synthesisableFields('AcademicYear')).toEqual(new Set(['yearCode']));
    expect(synthesisableFields('User')).toEqual(new Set(['keycloakId']));
  });

  it('returns an empty set for an unknown model', () => {
    expect(synthesisableFields('NonExistentModel')).toEqual(new Set());
  });

  it('covers the top-10 shape-gap targets', () => {
    const targets = [
      'AcademicYear', 'User', 'Person', 'PersonName', 'PersonAddress',
      'PersonNationality', 'Programme', 'Module', 'Enrolment', 'ModuleRegistration',
    ];
    for (const t of targets) {
      expect(synthesisableFields(t).size, `${t} has no synthesiser`).toBeGreaterThan(0);
    }
  });
});

describe('applySynthesisers', () => {
  it('aliases column names (AcademicYear.yearCode <- year)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('2025/26');
  });

  it('stubs a constant (User.keycloakId)', () => {
    const row = { id: 'user-vc' };
    applySynthesisers('User', row, {});
    expect(row.keycloakId).toBe('kc-user-vc');
  });

  it('looks up auxiliary data (Person.firstName/lastName via personNames map)', () => {
    const row = { id: 'p-00000042' };
    const synthCtx = {
      personNames: new Map([['p-00000042', { firstName: 'Ada', lastName: 'Lovelace' }]]),
    };
    applySynthesisers('Person', row, synthCtx);
    expect(row.firstName).toBe('Ada');
    expect(row.lastName).toBe('Lovelace');
  });

  it('falls back to stubs when an auxiliary lookup misses', () => {
    const row = { id: 'p-99999999' };
    applySynthesisers('Person', row, { personNames: new Map() });
    expect(row.firstName).toBe('Unknown');
    expect(row.lastName).toBe('Person');
  });

  it('preserves an existing non-empty CSV value (CSV wins)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26', yearCode: 'PRE-EXISTING' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('PRE-EXISTING');
  });

  it('overwrites an empty string (treated as missing)', () => {
    const row = { id: 'ay-2025-26', year: '2025/26', yearCode: '' };
    applySynthesisers('AcademicYear', row, {});
    expect(row.yearCode).toBe('2025/26');
  });

  it('derives PersonAddress.personId from a composite id', () => {
    const row = {
      id: 'p-00000042-a1', line1: '10 Downing St', createdAt: '2026-01-01T00:00:00Z',
    };
    applySynthesisers('PersonAddress', row, {});
    expect(row.personId).toBe('p-00000042');
    expect(row.addressLine1).toBe('10 Downing St');
    expect(row.addressType).toBe('HOME');
    expect(row.startDate).toBe('2026-01-01T00:00:00Z');
  });

  it('maps Programme.level from numeric fheqLevel to ProgrammeLevel enum', () => {
    const ug = { id: 'prog-1', code: 'BSC01', name: 'BSc Maths', fheqLevel: '6' };
    applySynthesisers('Programme', ug, {});
    expect(ug.programmeCode).toBe('BSC01');
    expect(ug.title).toBe('BSc Maths');
    expect(ug.level).toBe('LEVEL_6');
    expect(ug.creditTotal).toBe('360');

    const pgr = { id: 'prog-2', code: 'PHD01', name: 'PhD Maths', fheqLevel: '8' };
    applySynthesisers('Programme', pgr, {});
    expect(pgr.level).toBe('LEVEL_8');
    expect(pgr.creditTotal).toBe('540');
  });

  it('resolves Enrolment.academicYear via the academic-year map', () => {
    const row = {
      id: 'en-1', academicYearId: 'ay-2025-26',
      yearOfProgramme: '2', enrolmentDate: '2025-09-29T00:00:00Z',
    };
    const synthCtx = { academicYears: new Map([['ay-2025-26', '2025/26']]) };
    applySynthesisers('Enrolment', row, synthCtx);
    expect(row.academicYear).toBe('2025/26');
    expect(row.yearOfStudy).toBe('2');
    expect(row.startDate).toBe('2025-09-29T00:00:00Z');
    expect(row.feeStatus).toBe('HOME');
  });

  it('is a no-op for a model with no synthesiser', () => {
    const before = { id: 'x', foo: 'bar' };
    const after = applySynthesisers('NotInTheMap', { ...before }, {});
    expect(after).toEqual(before);
  });
});

describe('loadSynthContext', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'synthctx-'));
    await writeCsv({
      outDir: dir, table: 'academic_years',
      columns: ['id', 'year'],
      rows: [
        { id: 'ay-2024-25', year: '2024/25' },
        { id: 'ay-2025-26', year: '2025/26' },
      ],
    });
    await writeCsv({
      outDir: dir, table: 'person_names',
      columns: ['id', 'personId', 'firstName', 'lastName'],
      rows: [
        { id: 'p-1-n1', personId: 'p-1', firstName: 'Alice', lastName: 'Smith' },
        { id: 'p-2-n1', personId: 'p-2', firstName: 'Bob', lastName: 'Jones' },
      ],
    });
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('loads academic_years and person_names into maps', async () => {
    const ctx = await loadSynthContext(dir);
    expect(ctx.academicYears.get('ay-2024-25')).toBe('2024/25');
    expect(ctx.academicYears.get('ay-2025-26')).toBe('2025/26');
    expect(ctx.personNames.get('p-1')).toEqual({ firstName: 'Alice', lastName: 'Smith' });
    expect(ctx.personNames.get('p-2')).toEqual({ firstName: 'Bob', lastName: 'Jones' });
  });

  it('returns empty maps when auxiliary CSVs are absent', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'synthctx-empty-'));
    try {
      const ctx = await loadSynthContext(empty);
      expect(ctx.academicYears.size).toBe(0);
      expect(ctx.personNames.size).toBe(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('classifyTables — synthesiser-aware shape check', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'synth-classify-'));
    // academic_years CSV has `year` but NOT `yearCode` — the SJMS-5
    // shape check should treat this as covered (synthesiser exists)
    // rather than shape-incompatible.
    await writeCsv({
      outDir: dir, table: 'academic_years',
      columns: ['id', 'year', 'startDate', 'endDate', 'createdAt', 'updatedAt'],
      rows: [{
        id: 'ay-2025-26', year: '2025/26',
        startDate: new Date('2025-09-29'), endDate: new Date('2026-08-31'),
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
      }],
    });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      generatorVersion: '0.1.0', seed: 'synth-test',
      generatedAt: '2026-05-19T00:00:00Z',
      schemaHash: 'synth', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { academic_years: 1 },
    }));
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('treats academic_years.yearCode as available via the synthesiser', async () => {
    const schema = {
      models: new Map([
        ['AcademicYear', {
          tableMap: 'academic_years',
          fields: [
            { name: 'id', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: true, isUnique: false, defaultExpr: 'cuid()' },
            { name: 'yearCode', type: 'String', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: true, defaultExpr: undefined },
            { name: 'startDate', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: undefined },
            { name: 'endDate', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: undefined },
            { name: 'createdAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
            { name: 'updatedAt', type: 'DateTime', isEnum: false, isArray: false, isOptional: false, isId: false, isUnique: false, defaultExpr: 'now()' },
          ],
        }],
      ]),
      enums: new Set(),
    };
    const manifest = {
      schemaHash: 'synth', schemaModels: 298, totalTables: 1, totalRows: 1,
      rowCounts: { academic_years: 1 },
    };
    const c = await classifyTables(dir, manifest, schema);
    const covered = c.covered.find((e) => e.datasetModel === 'AcademicYear');
    expect(covered).toBeDefined();
    expect(covered.importableFields.map((f) => f.name)).toContain('yearCode');
    for (const s of c.skippedShape) {
      expect(s.missingRequired).not.toContain('yearCode');
    }
  });
});

describe('COLUMN_SYNTHESISERS — fixed catalogue', () => {
  it('covers every advertised SJMS-5 model', () => {
    const keys = Object.keys(COLUMN_SYNTHESISERS).sort();
    expect(keys).toEqual([
      'AcademicYear', 'Enrolment', 'Module', 'ModuleRegistration',
      'Person', 'PersonAddress', 'PersonName', 'PersonNationality',
      'Programme', 'User',
    ]);
  });
});
