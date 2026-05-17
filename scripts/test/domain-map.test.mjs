import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_DOMAIN, DOMAINS, modelsByDomain, verifyCoverage, TOPOLOGICAL_ORDER }
  from '../sjms-data/lib/domain-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('domain-map', () => {
  it('covers every model in docs/dataset/MODELS.txt', () => {
    const schemaModels = readFileSync(path.join(REPO_ROOT, 'docs/dataset/MODELS.txt'), 'utf8')
      .trim()
      .split('\n');
    const result = verifyCoverage(schemaModels);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
  });

  it('every assigned domain is in DOMAINS', () => {
    const seen = new Set(Object.values(MODEL_DOMAIN));
    for (const d of seen) expect(DOMAINS).toContain(d);
  });

  it('topological order includes every domain', () => {
    expect(new Set(TOPOLOGICAL_ORDER)).toEqual(new Set(DOMAINS));
  });

  it('modelsByDomain groups consistently', () => {
    const grouped = modelsByDomain();
    let total = 0;
    for (const models of grouped.values()) total += models.length;
    expect(total).toBe(Object.keys(MODEL_DOMAIN).length);
  });

  it('reference runs before estates so HesaCostCentre is available for DepartmentCostCentre', () => {
    const refIdx = TOPOLOGICAL_ORDER.indexOf('reference');
    const estIdx = TOPOLOGICAL_ORDER.indexOf('estates');
    const govIdx = TOPOLOGICAL_ORDER.indexOf('governance');
    expect(refIdx).toBeLessThan(estIdx);
    expect(refIdx).toBeLessThan(govIdx);
  });

  it('finance-student runs after awards so Fee.enrolmentId can resolve', () => {
    const finIdx = TOPOLOGICAL_ORDER.indexOf('finance-student');
    const awdIdx = TOPOLOGICAL_ORDER.indexOf('awards');
    expect(finIdx).toBeGreaterThan(awdIdx);
  });
});
