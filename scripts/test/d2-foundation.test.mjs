/**
 * D2 foundation-tier integration test.
 *
 * Locks the expected row counts for identity / reference / estates /
 * governance so D3+ phases don't accidentally regress the foundation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DRIVER = path.join(REPO_ROOT, 'scripts', 'generate-synthetic-dataset.mjs');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [DRIVER, ...args], { cwd: REPO_ROOT });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}\n${err}`));
    });
  });
}

describe('D2 foundation tier', () => {
  let out;
  let manifest;

  beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), 'sjms5-d2-'));
    await run(['--out', out, '--seed', 'd2-test']);
    manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
  }, 120_000);

  afterAll(async () => { await rm(out, { recursive: true, force: true }); });

  it('emits exactly 6 faculties', () => {
    expect(manifest.rowCounts.faculties).toBe(6);
  });

  it('emits exactly 48 departments', () => {
    expect(manifest.rowCounts.departments).toBe(48);
  });

  it('emits one DepartmentCostCentre per department', () => {
    expect(manifest.rowCounts.department_cost_centres).toBe(48);
  });

  it('emits 32 committees (14 standing + 18 faculty-level)', () => {
    expect(manifest.rowCounts.committees).toBe(32);
  });

  it('emits 7 academic years (2020/21 through 2026/27)', () => {
    expect(manifest.rowCounts.academic_years).toBe(7);
  });

  it('emits 45 HESA cost centres', () => {
    expect(manifest.rowCounts.hesa_cost_centres).toBe(45);
  });

  it('emits 1 tenant configuration row', () => {
    expect(manifest.rowCounts.tenant_configurations).toBe(1);
  });

  it('emits 12 accommodation halls', () => {
    expect(manifest.rowCounts.accommodation_halls).toBe(12);
  });

  it('emits 30 buildings', () => {
    expect(manifest.rowCounts.buildings).toBe(30);
  });

  it('emits ≥ 1000 committee meetings (5 years × cadence)', () => {
    expect(manifest.rowCounts.committee_meetings).toBeGreaterThan(1000);
  });

  it('emits ≥ 300 committee members', () => {
    expect(manifest.rowCounts.committee_members).toBeGreaterThan(300);
  });

  it('emits ≥ 500 rooms across the teaching estate', () => {
    expect(manifest.rowCounts.rooms).toBeGreaterThan(500);
  });

  it('governance breakouts present in manifest', () => {
    expect(manifest.governanceCounts.faculties).toBe(6);
    expect(manifest.governanceCounts.departments).toBe(48);
  });
});
