import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrismaSchema, columnsFor, columnIndex } from '../sjms-data/lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  __dirname, '..', '..', '..', 'sjms-v4-integrated', 'prisma', 'schema.prisma',
);

describe('Prisma schema parser', () => {
  it('extracts all 298 models', async () => {
    const schema = await parsePrismaSchema(SCHEMA_PATH);
    expect(schema.models.size).toBe(298);
  });

  it('keeps scalar fields and skips relations', async () => {
    const schema = await parsePrismaSchema(SCHEMA_PATH);
    const dept = schema.models.get('Department');
    expect(dept).toBeDefined();
    const cols = columnsFor(dept);
    // facultyId (scalar FK) kept; faculty (relation object) dropped.
    expect(cols).toContain('facultyId');
    expect(cols).not.toContain('faculty');
  });

  it('captures @@map snake_case table names', async () => {
    const schema = await parsePrismaSchema(SCHEMA_PATH);
    expect(schema.models.get('Faculty').tableMap).toBe('faculties');
    expect(schema.models.get('Department').tableMap).toBe('departments');
    expect(schema.models.get('DepartmentCostCentre').tableMap).toBe('department_cost_centres');
  });

  it('columnIndex returns every model', async () => {
    const schema = await parsePrismaSchema(SCHEMA_PATH);
    const idx = columnIndex(schema);
    expect(idx.size).toBe(298);
    expect(idx.get('Student')).toContain('id');
    expect(idx.get('Student')).toContain('studentNumber');
  });
});
