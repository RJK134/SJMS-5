import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeCsv } from '../sjms-data/lib/csv-writer.mjs';
import { readCsvAll, readCsvRows, readCsvHeader } from '../sjms-data/lib/csv-reader.mjs';

describe('csv-reader', () => {
  let dir;
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'csv-reader-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('round-trips simple values', async () => {
    const { path: file } = await writeCsv({
      outDir: dir, table: 'simple', columns: ['id', 'name', 'count'],
      rows: [
        { id: 'a', name: 'Alice', count: 1 },
        { id: 'b', name: 'Bob', count: 2 },
      ],
    });
    const rows = await readCsvAll(file);
    expect(rows).toEqual([
      { id: 'a', name: 'Alice', count: '1' },
      { id: 'b', name: 'Bob', count: '2' },
    ]);
  });

  it('round-trips quoted values containing commas and newlines', async () => {
    const { path: file } = await writeCsv({
      outDir: dir, table: 'quoted', columns: ['id', 'text'],
      rows: [
        { id: '1', text: 'with, comma' },
        { id: '2', text: 'with "quotes" inside' },
        { id: '3', text: 'with\nembedded\nnewlines' },
      ],
    });
    const rows = await readCsvAll(file);
    expect(rows).toEqual([
      { id: '1', text: 'with, comma' },
      { id: '2', text: 'with "quotes" inside' },
      { id: '3', text: 'with\nembedded\nnewlines' },
    ]);
  });

  it('preserves empty cells as empty strings', async () => {
    const { path: file } = await writeCsv({
      outDir: dir, table: 'empty', columns: ['id', 'a', 'b'],
      rows: [{ id: '1', a: null, b: undefined }],
    });
    const rows = await readCsvAll(file);
    expect(rows).toEqual([{ id: '1', a: '', b: '' }]);
  });

  it('round-trips ISO date strings and stringified JSON arrays / objects', async () => {
    const { path: file } = await writeCsv({
      outDir: dir, table: 'shapes', columns: ['id', 'when', 'tags', 'meta'],
      rows: [
        {
          id: '1',
          when: new Date('2026-05-17T19:40:11.653Z'),
          tags: ['a', 'b'],
          meta: { foo: 1, bar: 'baz' },
        },
      ],
    });
    const rows = await readCsvAll(file);
    expect(rows[0].id).toBe('1');
    expect(rows[0].when).toBe('2026-05-17T19:40:11.653Z');
    expect(JSON.parse(rows[0].tags)).toEqual(['a', 'b']);
    expect(JSON.parse(rows[0].meta)).toEqual({ foo: 1, bar: 'baz' });
  });

  it('streaming mode yields rows one at a time', async () => {
    const rows = [];
    for (let n = 0; n < 1000; n++) rows.push({ id: `id-${n}`, n });
    const { path: file } = await writeCsv({
      outDir: dir, table: 'stream', columns: ['id', 'n'], rows,
    });
    let count = 0;
    let first = null;
    let last = null;
    for await (const row of readCsvRows(file)) {
      if (count === 0) first = row;
      last = row;
      count++;
    }
    expect(count).toBe(1000);
    expect(first).toEqual({ id: 'id-0', n: '0' });
    expect(last).toEqual({ id: 'id-999', n: '999' });
  });

  it('readCsvHeader returns just the header row', async () => {
    const file = path.join(dir, 'just-header.csv');
    await writeFile(file, 'a,b,"c,with,commas"\nrow,row,row\n', 'utf8');
    expect(await readCsvHeader(file)).toEqual(['a', 'b', 'c,with,commas']);
  });

  it('tolerates CRLF line endings', async () => {
    const file = path.join(dir, 'crlf.csv');
    await writeFile(file, 'id,name\r\n1,Alice\r\n2,Bob\r\n', 'utf8');
    expect(await readCsvAll(file)).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
  });

  it('throws on unterminated quoted field', async () => {
    const file = path.join(dir, 'broken.csv');
    await writeFile(file, 'id,text\n1,"never closes\n', 'utf8');
    await expect(readCsvAll(file)).rejects.toThrow(/Unterminated quoted field/);
  });
});
