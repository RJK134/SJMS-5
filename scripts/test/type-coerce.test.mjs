import { describe, it, expect } from 'vitest';
import { coerceRow, coerceValue } from '../sjms-data/lib/type-coerce.mjs';

const ctx = { table: 'test', line: 2 };
function field(over) {
  return {
    name: 'x', type: 'String', isEnum: false, isArray: false,
    isOptional: false, isId: false, isUnique: false, defaultExpr: undefined,
    ...over,
  };
}

describe('coerceValue', () => {
  it('passes String through verbatim', () => {
    expect(coerceValue('hello', field({ type: 'String' }), ctx)).toBe('hello');
  });

  it('coerces Int and rejects non-integers', () => {
    expect(coerceValue('42', field({ type: 'Int' }), ctx)).toBe(42);
    expect(coerceValue('-7', field({ type: 'Int' }), ctx)).toBe(-7);
    expect(() => coerceValue('3.14', field({ type: 'Int' }), ctx)).toThrow(/not an integer/);
    expect(() => coerceValue('NaN', field({ type: 'Int' }), ctx)).toThrow(/not an integer/);
  });

  it('coerces BigInt and rejects garbage', () => {
    expect(coerceValue('12345678901234567890', field({ type: 'BigInt' }), ctx))
      .toBe(BigInt('12345678901234567890'));
    expect(() => coerceValue('not-a-bigint', field({ type: 'BigInt' }), ctx)).toThrow(/not a BigInt/);
  });

  it('coerces Boolean from true/false/1/0', () => {
    expect(coerceValue('true', field({ type: 'Boolean' }), ctx)).toBe(true);
    expect(coerceValue('false', field({ type: 'Boolean' }), ctx)).toBe(false);
    expect(coerceValue('1', field({ type: 'Boolean' }), ctx)).toBe(true);
    expect(coerceValue('0', field({ type: 'Boolean' }), ctx)).toBe(false);
    expect(() => coerceValue('yes', field({ type: 'Boolean' }), ctx)).toThrow(/not a Boolean/);
  });

  it('coerces DateTime from ISO strings', () => {
    const d = coerceValue('2026-05-17T19:40:11.653Z', field({ type: 'DateTime' }), ctx);
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-05-17T19:40:11.653Z');
    expect(() => coerceValue('not-a-date', field({ type: 'DateTime' }), ctx)).toThrow(/not a DateTime/);
  });

  it('keeps Decimal as a string for Prisma to validate', () => {
    expect(coerceValue('99.99', field({ type: 'Decimal' }), ctx)).toBe('99.99');
  });

  it('coerces Float', () => {
    expect(coerceValue('3.14', field({ type: 'Float' }), ctx)).toBeCloseTo(3.14);
    expect(() => coerceValue('garbage', field({ type: 'Float' }), ctx)).toThrow(/not a Float/);
  });

  it('parses Json', () => {
    expect(coerceValue('{"a":1}', field({ type: 'Json' }), ctx)).toEqual({ a: 1 });
    expect(() => coerceValue('not-json', field({ type: 'Json' }), ctx)).toThrow(/Json parse failed/);
  });

  it('decodes Bytes from base64', () => {
    const b = coerceValue('aGVsbG8=', field({ type: 'Bytes' }), ctx);
    expect(b).toBeInstanceOf(Buffer);
    expect(b.toString('utf8')).toBe('hello');
  });

  it('passes enums through as strings', () => {
    expect(coerceValue('ACTIVE', field({ type: 'EnrolmentStatus', isEnum: true }), ctx)).toBe('ACTIVE');
  });

  it('parses arrays as JSON', () => {
    expect(coerceValue('["a","b","c"]', field({ type: 'String', isArray: true }), ctx))
      .toEqual(['a', 'b', 'c']);
    expect(() => coerceValue('not-array', field({ type: 'String', isArray: true }), ctx))
      .toThrow(/array parse failed/);
    expect(() => coerceValue('"not-an-array-but-valid-json"', field({ type: 'String', isArray: true }), ctx))
      .toThrow(/expected array/);
  });

  it('empty cell -> null when optional', () => {
    expect(coerceValue('', field({ type: 'String', isOptional: true }), ctx)).toBeNull();
  });

  it('empty cell -> undefined when required with a default (let Prisma apply default)', () => {
    expect(coerceValue('', field({ type: 'DateTime', defaultExpr: 'now()' }), ctx)).toBeUndefined();
  });

  it('empty cell -> throws when required with no default', () => {
    expect(() => coerceValue('', field({ name: 'firstName', type: 'String' }), ctx))
      .toThrow(/required field "firstName" is empty/);
  });
});

describe('coerceRow', () => {
  it('builds a typed object across a row of fields', () => {
    const fields = [
      field({ name: 'id', type: 'String' }),
      field({ name: 'age', type: 'Int' }),
      field({ name: 'active', type: 'Boolean' }),
      field({ name: 'joined', type: 'DateTime' }),
    ];
    const row = {
      id: 'p-1', age: '30', active: 'true', joined: '2026-05-17T00:00:00Z',
    };
    const out = coerceRow(row, fields, ctx);
    expect(out).toEqual({
      id: 'p-1', age: 30, active: true, joined: new Date('2026-05-17T00:00:00Z'),
    });
  });

  it('skips fields not present in the CSV (lets Prisma defaults apply)', () => {
    const fields = [
      field({ name: 'id', type: 'String' }),
      field({ name: 'createdAt', type: 'DateTime', defaultExpr: 'now()' }),
    ];
    const out = coerceRow({ id: 'p-1' }, fields, ctx);
    expect(out).toEqual({ id: 'p-1' });
  });
});
