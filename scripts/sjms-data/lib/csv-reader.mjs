/**
 * CSV reader — RFC 4180 streaming parser matching the csv-writer format.
 *
 * Pairs with `csv-writer.mjs`:
 *   - Comma separator, double-quote quoting with doubled embedded quotes
 *   - UTF-8, LF line endings (CRLF tolerated)
 *   - First row is the header
 *   - Empty cell -> empty string (callers coerce to null per schema)
 *
 * Streaming via async iteration so 400k-row CSVs (module_registrations)
 * do not have to materialise in memory.
 *
 * Hand-rolled rather than pulling `csv-parse` because the generator side
 * has no npm dependencies beyond Prisma + seedrandom; the importer keeps
 * the same constraint.
 */

import { createReadStream } from 'node:fs';

/**
 * @param {string} filePath
 * @returns {AsyncGenerator<Record<string, string>, void, void>}
 */
export async function* readCsvRows(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

  let header = null;
  let buffer = '';
  let inQuotes = false;
  let cells = [];
  let cell = '';
  let i = 0;

  const finishCell = () => {
    cells.push(cell);
    cell = '';
  };
  const finishRow = () => {
    if (!header) {
      header = cells;
    } else if (cells.length === 1 && cells[0] === '') {
      // Skip trailing empty line — matches the writer's `body + '\n'` tail.
    } else {
      const row = {};
      for (let k = 0; k < header.length; k++) row[header[k]] = cells[k] ?? '';
      // We yield outside this helper; the helper just resets state.
    }
    cells = [];
  };

  // Use a queue because finishRow must yield, which it can't do from a helper.
  /** @type {Array<Record<string, string>>} */
  const queue = [];

  const commitRow = () => {
    if (!header) {
      header = cells;
    } else if (cells.length === 1 && cells[0] === '') {
      // Trailing empty line from the writer's body+\n — discard.
    } else {
      const row = {};
      for (let k = 0; k < header.length; k++) row[header[k]] = cells[k] ?? '';
      queue.push(row);
    }
    cells = [];
  };

  for await (const chunk of stream) {
    buffer += chunk;
    i = 0;
    while (i < buffer.length) {
      const ch = buffer[i];

      if (inQuotes) {
        if (ch === '"') {
          // Lookahead — doubled quote is an escape; otherwise close.
          if (i + 1 < buffer.length) {
            if (buffer[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            inQuotes = false;
            i += 1;
            continue;
          }
          // End of buffer mid-quote-decision — keep the rest in the buffer.
          break;
        }
        cell += ch;
        i += 1;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        finishCell();
        i += 1;
        continue;
      }
      if (ch === '\n') {
        finishCell();
        commitRow();
        i += 1;
        while (queue.length) yield queue.shift();
        continue;
      }
      if (ch === '\r') {
        // CRLF tolerance — peek for the LF.
        if (i + 1 < buffer.length) {
          if (buffer[i + 1] === '\n') {
            finishCell();
            commitRow();
            i += 2;
            while (queue.length) yield queue.shift();
            continue;
          }
          finishCell();
          commitRow();
          i += 1;
          while (queue.length) yield queue.shift();
          continue;
        }
        // Defer until next chunk.
        break;
      }

      cell += ch;
      i += 1;
    }
    buffer = buffer.slice(i);
  }

  if (inQuotes) {
    throw new Error(`Unterminated quoted field at end of ${filePath}`);
  }

  if (cell.length > 0 || cells.length > 0) {
    finishCell();
    commitRow();
    while (queue.length) yield queue.shift();
  }
}

/**
 * Eager variant — collects all rows. Use only for small CSVs (tests, reference data).
 *
 * @param {string} filePath
 * @returns {Promise<Array<Record<string, string>>>}
 */
export async function readCsvAll(filePath) {
  const out = [];
  for await (const row of readCsvRows(filePath)) out.push(row);
  return out;
}

/**
 * Read just the header row of a CSV. Cheaper than `readCsvRows().next()`
 * because it stops after the first newline.
 *
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function readCsvHeader(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 4096 });

  let buffer = '';
  let inQuotes = false;
  for await (const chunk of stream) {
    buffer += chunk;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === '\n' && !inQuotes) {
        stream.destroy();
        return parseCsvLine(buffer.slice(0, i));
      }
    }
  }
  return parseCsvLine(buffer);
}

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { cells.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  cells.push(cell);
  return cells;
}
