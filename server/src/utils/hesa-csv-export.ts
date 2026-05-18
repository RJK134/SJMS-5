/**
 * Workstream C2 — HESA CSV export pure utility (first cut).
 *
 * Renders a {@link HesaReturnComposition} as a CSV string. The CSV
 * follows RFC 4180 escaping (double-quote any field containing a
 * comma, newline, or double-quote; double-quotes within escaped
 * fields are doubled).
 *
 * Pure — no Prisma, no file system, no network. The companion service
 * layer (`hesa.service::exportReturn`) loads the snapshot data and
 * pipes the resulting string through the HTTP response.
 *
 * British English column headers — operators reading the CSV in
 * Excel / LibreOffice see consistent terminology with the rest of the
 * platform.
 */

import type { HesaReturnComposition } from './hesa-return-composition';

/** A field is "special" when it requires CSV escaping per RFC 4180. */
function fieldNeedsEscape(value: string): boolean {
  return value.includes(',') || value.includes('\n') || value.includes('\r') || value.includes('"');
}

function formatField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);
  if (fieldNeedsEscape(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatRow(values: ReadonlyArray<unknown>): string {
  return values.map(formatField).join(',');
}

/**
 * Render a HESA return composition as a CSV string.
 *
 * Layout:
 *   - Header row: `column_order` from the composition header.
 *     Empty header arrays are tolerated (e.g. STAFF return) and the
 *     output collapses to a single blank header line so downstream
 *     parsers do not choke.
 *   - Data rows: one per `line`, fields read in `column_order`.
 *   - Trailer: empty line + `# total: N` + `# errors: E warnings: W
 *     info: I` so the CSV is self-describing for operators.
 */
export function exportHesaReturnAsCsv(composition: HesaReturnComposition): string {
  const { header, lines, totals } = composition;
  const columnOrder = header.columnOrder.length > 0 ? header.columnOrder : [];

  const rows: string[] = [];

  // Header row — RecordKey + columns. RecordKey is always first so
  // each row is uniquely keyed for downstream joins / spot-checks.
  rows.push(formatRow(['RecordKey', 'EntityType', ...columnOrder]));

  for (const line of lines) {
    rows.push(
      formatRow([
        line.recordKey,
        line.entityType,
        ...columnOrder.map((col) => line.fields[col] ?? ''),
      ]),
    );
  }

  // Trailer — an operator-friendly summary; lines are CSV comments
  // (a leading "#" is widely understood in HESA tooling and is
  // ignored by spreadsheet importers when set to skip rows
  // beginning with the comment character).
  rows.push('');
  rows.push(`# Academic year,${formatField(header.academicYear)}`);
  rows.push(`# Return type,${formatField(header.returnType)}`);
  rows.push(`# Generated,${formatField(header.generatedDate.toISOString())}`);
  rows.push(`# Records,${totals.recordCount}`);
  rows.push(`# Errors,${totals.errorCount}`);
  rows.push(`# Warnings,${totals.warningCount}`);
  rows.push(`# Info,${totals.infoCount}`);

  return rows.join('\r\n');
}
