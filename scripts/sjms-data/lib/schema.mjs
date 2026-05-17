/**
 * Prisma schema parser — extracts model → scalar fields for the generator.
 *
 * Hand-written rather than @prisma/sdk-based so the generator runs on plain
 * Node 18 with no Prisma toolchain dependency. The schema is the source of
 * truth — when the schema grows, the generator picks up the new field set
 * automatically (subject to the model→domain assignment in
 * docs/dataset/MODEL-DOMAIN-MAP.md).
 *
 * What this parser keeps:
 *   - Every scalar field (String, Int, BigInt, Boolean, DateTime, Decimal,
 *     Float, Json, Bytes), with type + optional/required + array flag.
 *   - Enum types (treated as String at CSV-write time).
 *   - Foreign-key columns (the `<fooId> String` style, NOT the @relation
 *     object — `foo Foo @relation(fields: [fooId])` produces a scalar
 *     `fooId String` that's kept; the `foo Foo` relation field is skipped).
 *   - @id, @unique, @default annotations as field-level metadata.
 *
 * What this parser drops:
 *   - Relation fields (only scalars hit the CSV).
 *   - @@index, @@unique, @@map block-level attributes (not relevant for
 *     CSV column listing — the importer reads the schema itself).
 */

import { readFile } from 'node:fs/promises';

const SCALAR_TYPES = new Set([
  'String', 'Int', 'BigInt', 'Boolean', 'DateTime',
  'Decimal', 'Float', 'Json', 'Bytes',
]);

/**
 * @returns {Promise<{ models: Map<string, { fields: Field[], tableMap?: string }>, enums: Set<string> }>}
 */
export async function parsePrismaSchema(schemaPath) {
  const src = await readFile(schemaPath, 'utf8');

  const enums = new Set();
  const enumRe = /^enum\s+(\w+)\s*\{/gm;
  let m;
  while ((m = enumRe.exec(src))) enums.add(m[1]);

  const models = new Map();
  const modelBlockRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  while ((m = modelBlockRe.exec(src))) {
    const [, name, body] = m;
    const fields = [];
    let tableMap;

    for (let line of body.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@index') ||
          line.startsWith('@@unique') || line.startsWith('@@id')) continue;
      if (line.startsWith('@@map')) {
        const mapMatch = line.match(/@@map\("([^"]+)"\)/);
        if (mapMatch) tableMap = mapMatch[1];
        continue;
      }

      const fm = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!fm) continue;
      const [, fieldName, rawType, isArray, isOptional, rest] = fm;

      // Skip relation objects — the scalar FK column (`fooId`) is what we want.
      if (!SCALAR_TYPES.has(rawType) && !enums.has(rawType)) continue;

      // Skip relation-only attributes — these are scalar fields backing a relation,
      // which IS what we want, so keep going.

      const isId = /@id\b/.test(rest);
      const isUnique = /@unique\b/.test(rest);
      const defaultMatch = rest.match(/@default\(([^)]+)\)/);
      const defaultExpr = defaultMatch ? defaultMatch[1] : undefined;

      fields.push({
        name: fieldName,
        type: rawType,
        isEnum: enums.has(rawType),
        isArray: Boolean(isArray),
        isOptional: Boolean(isOptional),
        isId,
        isUnique,
        defaultExpr,
      });
    }

    models.set(name, { fields, tableMap });
  }

  return { models, enums };
}

/**
 * Convenience — returns just the column names for a model, in declaration order.
 */
export function columnsFor(model) {
  return model.fields.map((f) => f.name);
}

/**
 * Build a quick-lookup map { ModelName → string[] of column names }
 */
export function columnIndex(schema) {
  const idx = new Map();
  for (const [name, model] of schema.models) idx.set(name, columnsFor(model));
  return idx;
}
