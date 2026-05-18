import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(p);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DRIVER = path.join(REPO_ROOT, 'scripts', 'generate-synthetic-dataset.mjs');

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [DRIVER, ...args], {
      cwd: REPO_ROOT, env: { ...process.env, ...env },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`exit ${code}\n${err}`));
    });
  });
}

describe('generator end-to-end', () => {
  let outA, outB;

  beforeAll(async () => {
    outA = await mkdtemp(path.join(tmpdir(), 'sjms5-gen-a-'));
    outB = await mkdtemp(path.join(tmpdir(), 'sjms5-gen-b-'));
    // Scale 0.05 keeps determinism semantics while running in <10s.
    // Determinism + shape are what we assert; volumes are exercised by the
    // d2-foundation suite at full scale.
    await run(['--out', outA, '--seed', 'det-test', '--scale', '0.05']);
    await run(['--out', outB, '--seed', 'det-test', '--scale', '0.05']);
  }, 300_000);

  afterAll(async () => {
    await rm(outA, { recursive: true, force: true });
    await rm(outB, { recursive: true, force: true });
  });

  it('writes 298 CSVs plus 1 manifest', async () => {
    const files = await readdir(outA);
    const csvs = files.filter((f) => f.endsWith('.csv'));
    const manifests = files.filter((f) => f === 'manifest.json');
    expect(csvs.length).toBe(298);
    expect(manifests.length).toBe(1);
  });

  it('produces byte-identical CSVs across runs with the same seed (hash-based)', async () => {
    const filesA = (await readdir(outA)).filter((f) => f.endsWith('.csv')).sort();
    const filesB = (await readdir(outB)).filter((f) => f.endsWith('.csv')).sort();
    expect(filesA).toEqual(filesB);
    // Hash-based comparison — avoids loading 500MB into memory at full scale.
    for (const name of filesA) {
      const hashA = await hashFile(path.join(outA, name));
      const hashB = await hashFile(path.join(outB, name));
      expect(hashA, `${name}`).toBe(hashB);
    }
  });

  it('manifest has expected shape', async () => {
    const m = JSON.parse(await readFile(path.join(outA, 'manifest.json'), 'utf8'));
    expect(m.generatorVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.seed).toBe('det-test');
    expect(m.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.schemaModels).toBe(298);
    expect(m.totalTables).toBe(298);
    expect(typeof m.rowCounts).toBe('object');
    expect(Object.keys(m.rowCounts).length).toBe(298);
  });

  it('every CSV has at least the header row', async () => {
    const files = (await readdir(outA)).filter((f) => f.endsWith('.csv'));
    for (const f of files) {
      const s = await stat(path.join(outA, f));
      expect(s.size).toBeGreaterThan(0);
    }
  });
});
