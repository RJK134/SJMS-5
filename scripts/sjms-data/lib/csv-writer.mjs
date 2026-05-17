/**
 * CSV writer — RFC 4180 + UTF-8 + LF endings + Python csv.DictWriter-compatible.
 *
 * Matches the encoding the workhorse uses for its datalake CSVs so SJMS-5
 * importers can reuse Maieus2's csv-parse pattern unchanged:
 *
 *   - Comma separator
 *   - Double-quote quoting; embedded quotes doubled
 *   - LF line endings (no CRLF, no BOM)
 *   - Header row written first
 *   - Arrays serialised as JSON (matches Postgres TEXT[] round-trip)
 *   - Objects serialised as JSON (matches Postgres JSON/JSONB)
 *   - null → empty cell
 *   - undefined → empty cell
 *   - Date → ISO 8601 string
 *   - Decimal-shaped strings preserved verbatim
 *
 * FORBIDDEN_COLUMNS — the writer refuses any column whose header matches
 * a forbidden pattern. This makes it impossible for any generator to
 * emit copyrighted past-paper / mark-scheme / answer-key text into the
 * lake, even by mistake.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const FORBIDDEN_COLUMNS = new Set([
  'body',
  'questionText',
  'question_text',
  'markScheme',
  'mark_scheme',
  'answerKey',
  'answer_key',
  'answer',
  'solution',
  'solutionText',
  'solution_text',
  'modelAnswer',
  'model_answer',
  'examPaperText',
  'exam_paper_text',
]);

export class ForbiddenColumnError extends Error {
  constructor(table, column) {
    super(`Generator refused to write column "${column}" in table "${table}" — matches FORBIDDEN_COLUMNS rule (copyrighted-content protection).`);
    this.name = 'ForbiddenColumnError';
    this.table = table;
    this.column = column;
  }
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) value = JSON.stringify(value);
  else if (typeof value === 'object') value = JSON.stringify(value);
  else value = String(value);

  // Always quote — matches Python csv.DictWriter(quoting=QUOTE_MINIMAL) only when
  // needed, but quoting everything is interoperable and simpler.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Write a CSV file.
 *
 * @param {object} opts
 * @param {string} opts.outDir
 * @param {string} opts.table       — base filename, no extension
 * @param {string[]} opts.columns   — header row
 * @param {object[]} opts.rows      — array of records keyed by column
 * @returns {Promise<{ path: string, rowCount: number }>}
 */
export async function writeCsv({ outDir, table, columns, rows }) {
  for (const c of columns) {
    if (FORBIDDEN_COLUMNS.has(c)) throw new ForbiddenColumnError(table, c);
  }

  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(','));
  }
  const body = lines.join('\n') + '\n';

  const target = path.join(outDir, `${table}.csv`);
  await writeFile(target, body, 'utf8');
  return { path: target, rowCount: rows.length };
}

export { FORBIDDEN_COLUMNS };
