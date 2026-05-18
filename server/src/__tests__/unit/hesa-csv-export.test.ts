import { describe, it, expect } from 'vitest';
import { exportHesaReturnAsCsv } from '../../utils/hesa-csv-export';
import type { HesaReturnComposition } from '../../utils/hesa-return-composition';

const fixedDate = new Date('2026-01-15T09:00:00Z');

const baseComposition = (overrides: Partial<HesaReturnComposition> = {}): HesaReturnComposition => ({
  header: {
    academicYear: '2025/26',
    returnType: 'STUDENT',
    generatedDate: fixedDate,
    generatedBy: 'user-1',
    columnOrder: ['HUSID', 'ETHNIC', 'POSTCODE'],
  },
  lines: [],
  validationResults: [],
  totals: {
    recordCount: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    skippedRuleCount: 0,
  },
  notes: [],
  ...overrides,
});

describe('exportHesaReturnAsCsv (pure)', () => {
  it('emits a header row plus trailer summary on an empty composition', () => {
    const csv = exportHesaReturnAsCsv(baseComposition());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('RecordKey,EntityType,HUSID,ETHNIC,POSTCODE');
    expect(lines.some((l) => l.startsWith('# Records,0'))).toBe(true);
    expect(lines.some((l) => l.startsWith('# Errors,0'))).toBe(true);
    expect(lines.some((l) => l.startsWith('# Warnings,0'))).toBe(true);
    expect(lines.some((l) => l.startsWith('# Info,0'))).toBe(true);
    expect(lines.some((l) => l.startsWith('# Academic year'))).toBe(true);
  });

  it('writes one data row per line, columns in declared order', () => {
    const csv = exportHesaReturnAsCsv(
      baseComposition({
        lines: [
          {
            recordKey: '202500001',
            entityType: 'HESAStudent',
            entityId: 'hs-1',
            fields: { HUSID: '202500001', ETHNIC: '15', POSTCODE: 'SW1A 1AA' },
            sortOrder: 0,
          },
          {
            recordKey: '202500002',
            entityType: 'HESAStudent',
            entityId: 'hs-2',
            fields: { HUSID: '202500002', ETHNIC: '20', POSTCODE: 'EH1 1YZ' },
            sortOrder: 1,
          },
        ],
        totals: {
          recordCount: 2,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          skippedRuleCount: 0,
        },
      }),
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('202500001,HESAStudent,202500001,15,SW1A 1AA');
    expect(lines[2]).toBe('202500002,HESAStudent,202500002,20,EH1 1YZ');
    expect(lines.some((l) => l.startsWith('# Records,2'))).toBe(true);
  });

  it('escapes fields containing commas, double-quotes, or newlines per RFC 4180', () => {
    const csv = exportHesaReturnAsCsv(
      baseComposition({
        header: {
          academicYear: '2025/26',
          returnType: 'STUDENT',
          generatedDate: fixedDate,
          generatedBy: 'user-1',
          columnOrder: ['NAME', 'NOTES'],
        },
        lines: [
          {
            recordKey: 'X1',
            entityType: 'HESAStudent',
            entityId: 'hs-1',
            fields: {
              NAME: 'Smith, John',
              NOTES: 'He said "Yes"\nthen left',
            },
            sortOrder: 0,
          },
        ],
        totals: {
          recordCount: 1,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          skippedRuleCount: 0,
        },
      }),
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('X1,HESAStudent,"Smith, John","He said ""Yes""\nthen left"');
  });

  it('renders missing field values as empty strings', () => {
    const csv = exportHesaReturnAsCsv(
      baseComposition({
        lines: [
          {
            recordKey: 'X1',
            entityType: 'HESAStudent',
            entityId: 'hs-1',
            fields: { HUSID: 'X1' },
            sortOrder: 0,
          },
        ],
        totals: {
          recordCount: 1,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          skippedRuleCount: 0,
        },
      }),
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('X1,HESAStudent,X1,,');
  });

  it('uses a placeholder header row when columnOrder is empty (e.g. STAFF return)', () => {
    const csv = exportHesaReturnAsCsv(
      baseComposition({
        header: {
          academicYear: '2025/26',
          returnType: 'STAFF',
          generatedDate: fixedDate,
          generatedBy: 'user-1',
          columnOrder: [],
        },
      }),
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('RecordKey,EntityType');
    expect(lines.some((l) => l.startsWith('# Return type,STAFF'))).toBe(true);
  });
});
