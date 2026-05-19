/**
 * CSV string -> Prisma scalar coercion, driven by the parsed schema.
 *
 * The CSV writer encodes:
 *   - null / undefined     -> empty cell
 *   - Date                 -> ISO 8601 string
 *   - Array / object       -> JSON.stringify(...) (with outer quoting if needed)
 *   - Numbers / booleans   -> String(...)
 *
 * This module reverses that, keyed off each field's parsed type metadata
 * from `schema.mjs`:
 *
 *   - String / enum        -> string  (empty -> null when optional)
 *   - Int                  -> Number  (rejects non-integer / NaN)
 *   - BigInt               -> BigInt
 *   - Boolean              -> true / false  (accepts 'true'/'false'/'1'/'0')
 *   - DateTime             -> Date  (Date constructor; rejects Invalid Date)
 *   - Decimal              -> string  (Prisma accepts Decimal as string)
 *   - Float                -> Number
 *   - Json                 -> JSON.parse  (the writer stringifies objects/arrays)
 *   - Bytes                -> Buffer.from(base64)
 *
 * Optional fields with an empty CSV cell coerce to null. Required fields
 * with an empty CSV cell throw — that's a generator bug, not an import bug.
 */

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {string} type
 * @property {boolean} isEnum
 * @property {boolean} isArray
 * @property {boolean} isOptional
 * @property {boolean} isId
 * @property {boolean} isUnique
 * @property {string=} defaultExpr
 */

/**
 * Coerce a single CSV row (string-valued) into a Prisma-ready object for a model.
 *
 * @param {Record<string, string>} row
 * @param {Field[]} fields
 * @param {{ table: string, line: number }} ctx
 * @returns {Record<string, unknown>}
 */
export function coerceRow(row, fields, ctx) {
  const out = {};
  for (const field of fields) {
    const raw = row[field.name];
    if (raw === undefined) {
      // Column not in CSV — leave undefined so Prisma defaults / DB defaults apply.
      continue;
    }
    out[field.name] = coerceValue(raw, field, ctx);
  }
  return out;
}

/**
 * @param {string} raw
 * @param {Field} field
 * @param {{ table: string, line: number }} ctx
 */
export function coerceValue(raw, field, ctx) {
  if (raw === '' || raw === undefined || raw === null) {
    if (field.isOptional) return null;
    if (field.defaultExpr !== undefined) return undefined; // let Prisma / DB apply default
    throw new Error(
      `${ctx.table}:${ctx.line} required field "${field.name}" is empty (no value, no @default)`,
    );
  }

  if (field.isArray) {
    // CSV cell is a JSON-stringified array per the writer's contract.
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" expected array, got ${typeof parsed}`);
      }
      return parsed;
    } catch (err) {
      throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" array parse failed: ${err.message}`);
    }
  }

  if (field.isEnum) return raw;

  switch (field.type) {
    case 'String':
      return raw;
    case 'Int': {
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" not an integer: "${raw}"`);
      }
      return n;
    }
    case 'BigInt':
      try {
        return BigInt(raw);
      } catch {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" not a BigInt: "${raw}"`);
      }
    case 'Boolean':
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" not a Boolean: "${raw}"`);
    case 'DateTime': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" not a DateTime: "${raw}"`);
      }
      return d;
    }
    case 'Decimal':
      return raw; // Prisma accepts Decimal as a string and validates server-side.
    case 'Float': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" not a Float: "${raw}"`);
      }
      return n;
    }
    case 'Json':
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" Json parse failed: ${err.message}`);
      }
    case 'Bytes':
      return Buffer.from(raw, 'base64');
    default:
      throw new Error(`${ctx.table}:${ctx.line} field "${field.name}" unknown Prisma type "${field.type}"`);
  }
}
