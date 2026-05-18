/**
 * D11 importer scaffold smoke-test.
 *
 * Runs the full generator at scale 0.05 then runs the importer in
 * --dry-run mode against the snapshot. Verifies:
 *   - Importer accepts the manifest
 *   - Plan covers all 298 tables in topological order
 *   - FORBIDDEN_COLUMNS check passes (no copyrighted-content leak)
 *   - Schema reachability check passes
 *
 * Doesn't actually upsert anything — SJMS-5 has no Prisma schema yet.
 * Wires that in once Phase 0 of SJMS-5 lands.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-synthetic-dataset.mjs');
const IMPORTER = path.join(REPO_ROOT, 'scripts', 'import-sjms-dataset.mjs');

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

describe('D11 importer scaffold', () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await mkdtemp(path.join(tmpdir(), 'sjms5-d11-'));
    await run(GENERATOR, ['--out', snapshot, '--seed', 'd11-test', '--scale', '0.05']);
  }, 120_000);

  afterAll(async () => { await rm(snapshot, { recursive: true, force: true }); });

  it('importer dry-run completes successfully', async () => {
    const { out } = await run(IMPORTER, ['--source', snapshot, '--dry-run']);
    expect(out).toContain('Manifest:');
    expect(out).toContain('schema reachable: 298 models');
    expect(out).toContain('298 tables planned');
  });

  it('importer plan covers all 298 tables', async () => {
    const { out } = await run(IMPORTER, ['--source', snapshot, '--dry-run']);
    const planLines = out.split('\n').filter((l) => l.includes('PLAN:'));
    expect(planLines.length).toBe(298);
  });

  it('importer plan follows topological order (identity first, longtail last)', async () => {
    const { out } = await run(IMPORTER, ['--source', snapshot, '--dry-run']);
    const planLines = out.split('\n').filter((l) => l.includes('PLAN:'));
    expect(planLines[0]).toContain('identity');
    expect(planLines[planLines.length - 1]).toContain('longtail');
  });

  it('importer FORBIDDEN_COLUMNS check rejects bad headers', async () => {
    // Simulate a poisoned CSV
    const poisonedDir = await mkdtemp(path.join(tmpdir(), 'sjms5-d11-bad-'));
    try {
      // Copy a small file and append a forbidden column header
      const fsp = await import('node:fs/promises');
      // Copy manifest to satisfy verifier
      await fsp.copyFile(
        path.join(snapshot, 'manifest.json'),
        path.join(poisonedDir, 'manifest.json'),
      );
      // Write a poisoned faculties.csv
      await fsp.writeFile(
        path.join(poisonedDir, 'faculties.csv'),
        'id,createdAt,body\nfac-1,2026-05-17,illegal text\n',
        'utf8',
      );
      await expect(run(IMPORTER, ['--source', poisonedDir, '--dry-run']))
        .rejects.toThrow(/forbidden column "body"/);
    } finally {
      await rm(poisonedDir, { recursive: true, force: true });
    }
  });
});
