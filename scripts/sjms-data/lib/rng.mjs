/**
 * Deterministic RNG.
 *
 * Wraps seedrandom with the helpers every generator needs.
 * The seed flows from `SJMS_DATASET_SEED` env (default `'2026-05'`)
 * through to every generator; same seed = byte-identical CSV output.
 *
 * Pass the same RNG instance through every generator. Forking it
 * (e.g. `rng.fork('students')`) gives a child RNG keyed on the
 * parent's state plus a label so that sub-generators stay
 * deterministic even if added or reordered.
 */

import seedrandom from 'seedrandom';

export class Rng {
  constructor(seed) {
    this._seed = String(seed);
    this._rng = seedrandom(this._seed, { state: true });
  }

  get seed() {
    return this._seed;
  }

  next() {
    return this._rng();
  }

  int(min, max) {
    return Math.floor(this._rng() * (max - min + 1)) + min;
  }

  float(min, max) {
    return min + this._rng() * (max - min);
  }

  pick(arr) {
    if (!arr.length) throw new Error('Rng.pick called on empty array');
    return arr[Math.floor(this._rng() * arr.length)];
  }

  pickN(arr, n) {
    if (n > arr.length) throw new Error(`Rng.pickN: cannot pick ${n} from array of ${arr.length}`);
    return this.shuffle(arr).slice(0, n);
  }

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this._rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Box-Muller — for normally-distributed values (marks, salaries, ages around a mean)
  gauss(mean = 0, stdDev = 1) {
    const u1 = this._rng() || 1e-9;
    const u2 = this._rng();
    return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev;
  }

  // Bounded gauss — clamps to [min, max] and rounds to integer
  gaussInt(mean, stdDev, min, max) {
    const v = Math.round(this.gauss(mean, stdDev));
    return Math.min(max, Math.max(min, v));
  }

  // Weighted choice — entries = [[value, weight], ...]
  weighted(entries) {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this._rng() * total;
    for (const [value, weight] of entries) {
      r -= weight;
      if (r <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  // Probability test — returns true with probability p ∈ [0,1]
  chance(p) {
    return this._rng() < p;
  }

  // Fork a child RNG deterministically — label-scoped so sub-generators
  // stay stable even if other generators are added or reordered later.
  fork(label) {
    return new Rng(`${this._seed}:${label}`);
  }

  // Deterministic UUID v4-shaped id (16 bytes, formatted as UUID).
  // Not RFC-compliant — collision-resistant within a run, stable across reruns.
  uuid() {
    const hex = [];
    for (let i = 0; i < 16; i++) {
      hex.push(Math.floor(this._rng() * 256).toString(16).padStart(2, '0'));
    }
    hex[6] = '4' + hex[6][1];
    const variant = (parseInt(hex[8], 16) & 0x3f) | 0x80;
    hex[8] = variant.toString(16).padStart(2, '0');
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }
}

export function makeRng(seed) {
  return new Rng(seed ?? process.env.SJMS_DATASET_SEED ?? '2026-05');
}
