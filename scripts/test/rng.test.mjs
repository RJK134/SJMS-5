import { describe, it, expect } from 'vitest';
import { Rng, makeRng } from '../sjms-data/lib/rng.mjs';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('test-seed');
    const b = new Rng('test-seed');
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different seeds', () => {
    const a = new Rng('seed-one');
    const b = new Rng('seed-two');
    expect(a.next()).not.toEqual(b.next());
  });

  it('pick chooses from an array', () => {
    const rng = new Rng('pick-test');
    const items = ['alpha', 'beta', 'gamma', 'delta'];
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
  });

  it('weighted choice respects probability roughly', () => {
    const rng = new Rng('weighted');
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10_000; i++) {
      const r = rng.weighted([['a', 80], ['b', 20]]);
      counts[r] += 1;
    }
    expect(counts.a).toBeGreaterThan(7500);
    expect(counts.a).toBeLessThan(8500);
  });

  it('uuid produces a UUID-shaped string', () => {
    const rng = new Rng('uuid-test');
    const id = rng.uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('fork produces a child RNG with independent state', () => {
    const childA = new Rng('root').fork('students');
    const childB = new Rng('root').fork('staff');
    // Two children with different labels should not produce the same sequence.
    expect(childA.next()).not.toEqual(childB.next());
    // A child fork is deterministic across instances.
    const childA1 = new Rng('root').fork('students');
    const childA2 = new Rng('root').fork('students');
    expect(childA1.next()).toEqual(childA2.next());
    expect(childA1.next()).toEqual(childA2.next());
  });

  it('makeRng honours SJMS_DATASET_SEED', () => {
    const prev = process.env.SJMS_DATASET_SEED;
    process.env.SJMS_DATASET_SEED = 'env-seeded';
    try {
      const r = makeRng();
      expect(r.seed).toBe('env-seeded');
    } finally {
      if (prev === undefined) delete process.env.SJMS_DATASET_SEED;
      else process.env.SJMS_DATASET_SEED = prev;
    }
  });
});
