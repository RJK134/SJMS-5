import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeCsv, ForbiddenColumnError } from '../sjms-data/lib/csv-writer.mjs';

describe('csv-writer', () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'csv-writer-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a header-only CSV for empty rows', async () => {
    await writeCsv({ outDir: dir, table: 'demo', columns: ['id', 'name'], rows: [] });
    const out = await readFile(path.join(dir, 'demo.csv'), 'utf8');
    expect(out).toBe('id,name\n');
  });

  it('quotes fields containing commas, quotes, and newlines', async () => {
    await writeCsv({
      outDir: dir,
      table: 'esc',
      columns: ['a', 'b', 'c'],
      rows: [{ a: 'simple', b: 'has, comma', c: 'has "quotes"' }],
    });
    const out = await readFile(path.join(dir, 'esc.csv'), 'utf8');
    expect(out).toBe('a,b,c\nsimple,"has, comma","has ""quotes"""\n');
  });

  it('serialises arrays and objects as JSON (quoted because of embedded chars)', async () => {
    await writeCsv({
      outDir: dir,
      table: 'json',
      columns: ['arr', 'obj'],
      rows: [{ arr: [1, 2, 3], obj: { foo: 'bar' } }],
    });
    const out = await readFile(path.join(dir, 'json.csv'), 'utf8');
    // Arrays contain commas → quoted whole; objects contain quotes → quoted whole + quotes doubled.
    expect(out).toBe('arr,obj\n"[1,2,3]","{""foo"":""bar""}"\n');
  });

  it('emits empty cells for null and undefined', async () => {
    await writeCsv({
      outDir: dir,
      table: 'null',
      columns: ['a', 'b', 'c'],
      rows: [{ a: 'x', b: null, c: undefined }],
    });
    const out = await readFile(path.join(dir, 'null.csv'), 'utf8');
    expect(out).toBe('a,b,c\nx,,\n');
  });

  it('renders Date as ISO 8601', async () => {
    await writeCsv({
      outDir: dir,
      table: 'dt',
      columns: ['at'],
      rows: [{ at: new Date('2026-05-17T10:00:00Z') }],
    });
    const out = await readFile(path.join(dir, 'dt.csv'), 'utf8');
    expect(out).toBe('at\n2026-05-17T10:00:00.000Z\n');
  });

  it('refuses a forbidden column header', async () => {
    await expect(
      writeCsv({ outDir: dir, table: 'paper', columns: ['id', 'body'], rows: [] }),
    ).rejects.toThrow(ForbiddenColumnError);
  });

  it('refuses snake_case forbidden headers too', async () => {
    await expect(
      writeCsv({ outDir: dir, table: 'paper', columns: ['id', 'mark_scheme'], rows: [] }),
    ).rejects.toThrow(ForbiddenColumnError);
  });
});
