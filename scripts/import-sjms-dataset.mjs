#!/usr/bin/env node
/**
 * SJMS-5 dataset importer.
 *
 * Walks a snapshot folder in topological order, validates each CSV, and
 * (under --persist) upserts every row into the SJMS-5 Prisma database.
 *
 * Pipeline:
 *   1. Resolve --source (local dir, or rclone remote that gets synced to a tmp dir).
 *   2. Load the snapshot's manifest.json and verify the FORBIDDEN_COLUMNS gate.
 *   3. Parse the SJMS-5 Prisma schema (default: ./prisma/schema.prisma) and
 *      classify dataset tables as "covered" (model exists, CSV header is
 *      shape-compatible) or "skipped" (model missing, or required field
 *      missing from CSV). Skipped tables are logged but never imported.
 *   4. Walk the covered tables in the dataset's domain-by-domain
 *      TOPOLOGICAL_ORDER and upsert in batches inside a single Prisma
 *      transaction per batch.
 *   5. Emit a single `dataset.imported` AuditLog row at the end.
 *
 * Schema convergence note: the dataset targets `sjms-v4-integrated`
 * (298 models). SJMS-5 carries the smaller 196-model SJMS-2.5 schema.
 * The overlap is most of the SJMS-5 schema; the diff is logged at the
 * top of every run. Schema convergence proper is a Phase 12 concern
 * (KI-S5-202).
 *
 * Phase D0 follow-up — column synthesisers (see
 * scripts/sjms-data/lib/column-synthesisers.mjs) let the importer accept
 * tables whose CSV header is missing a required SJMS-5 column when the
 * value can be derived from another column, looked up via an auxiliary
 * CSV, or stubbed to a known default. Synthesisable columns count as
 * "available" for the shape check and are filled per-row at coerce time.
 *
 * Usage:
 *   node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17 --dry-run
 *   node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17 --persist
 *   node scripts/import-sjms-dataset.mjs --source gdrive5tb:sjms-5-dataset/latest/ --persist
 *
 * --persist requires DATABASE_URL to be set and the database to be
 * migrated to the SJMS-5 schema. Without --persist, the importer runs
 * in plan + validate mode and never opens a Prisma connection.
 */

import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TOPOLOGICAL_ORDER, modelsByDomain } from './sjms-data/lib/domain-map.mjs';
import { parsePrismaSchema } from './sjms-data/lib/schema.mjs';
import { readCsvRows, readCsvHeader } from './sjms-data/lib/csv-reader.mjs';
import { coerceRow } from './sjms-data/lib/type-coerce.mjs';
import {
  COLUMN_SYNTHESISERS,
  synthesisableFields,
  applySynthesisers,
  loadSynthContext,
} from './sjms-data/lib/column-synthesisers.mjs';

const FORBIDDEN_COLUMNS = new Set([
  'body', 'questionText', 'question_text', 'markScheme', 'mark_scheme',
  'answerKey', 'answer_key', 'answer', 'solution', 'solutionText', 'solution_text',
  'modelAnswer', 'model_answer', 'examPaperText', 'exam_paper_text',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCHEMA = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');

export function parseArgs(argv) {
  const args = {
    source: null,
    batch: 500,
    persist: false,
    dryRun: false,
    schemaPath: DEFAULT_SCHEMA,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--batch') args.batch = parseInt(argv[++i], 10);
    else if (a === '--persist') args.persist = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--schema') args.schemaPath = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write(helpText() + '\n');
      process.exit(0);
    }
  }
  if (!args.source) {
    process.stderr.write('--source is required (gdrive5tb:.../latest/ or a local directory)\n');
    process.exit(1);
  }
  if (args.persist && args.dryRun) {
    process.stderr.write('--persist and --dry-run are mutually exclusive\n');
    process.exit(1);
  }
  return args;
}

function helpText() {
  return `SJMS-5 dataset importer

Usage: node scripts/import-sjms-dataset.mjs --source <path-or-rclone-url> [flags]

  --source <path>     Local directory OR rclone remote (gdrive5tb:...). Required.
  --schema <path>     Target Prisma schema (default: ./prisma/schema.prisma)
  --persist           Actually upsert rows. Requires DATABASE_URL.
                      Without this, only plan + validate; never opens a DB connection.
  --batch <n>         Upsert batch size (default 500)
  --dry-run           Explicit no-write mode (alias for omitting --persist)
  -h, --help          This text

The importer is idempotent: re-running over the same snapshot upserts
the same rows. Run with --dry-run first to verify coverage and shape
before committing.`;
}

async function syncFromRclone(remote) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sjms5-import-'));
  process.stdout.write(`Pulling ${remote} -> ${dir} ...\n`);
  await new Promise((resolve, reject) => {
    const child = spawn('rclone', ['sync', remote, dir, '--progress'], { stdio: 'inherit' });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`rclone exit ${code}`)));
  });
  return dir;
}

async function loadManifest(dir) {
  const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

async function describeManifest(manifest, schemaModelCount) {
  process.stdout.write(`Manifest:  generated ${manifest.generatedAt}\n`);
  process.stdout.write(`           seed ${manifest.seed}\n`);
  process.stdout.write(`           ${manifest.totalTables} tables / ${manifest.totalRows.toLocaleString()} rows\n`);
  process.stdout.write(`           dataset schemaHash ${manifest.schemaHash}\n`);
  process.stdout.write(`           dataset schemaModels ${manifest.schemaModels}\n`);
  process.stdout.write(`           SJMS-5 schema models ${schemaModelCount}\n`);
  if (manifest.schemaModels !== schemaModelCount) {
    process.stdout.write(`           NOTE: model count differs (dataset ${manifest.schemaModels} vs SJMS-5 ${schemaModelCount}) — schema convergence is a Phase 12 concern; missing tables will be skipped\n`);
  }
}

function toSnakeCase(s) {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Walk the dataset's TOPOLOGICAL_ORDER and decide, for each dataset model,
 * whether to upsert it against the SJMS-5 schema.
 *
 * Returns:
 *   covered: tables that exist in SJMS-5 AND have a shape-compatible CSV header.
 *   skippedNoModel: dataset CSV exists, no matching SJMS-5 model.
 *   skippedShape: SJMS-5 model exists, but a required field is missing from the CSV header.
 *   skippedNoCsv: dataset model exists, but the snapshot has no CSV (rowCount 0 in manifest).
 *
 * A required SJMS-5 column counts as "available" if either:
 *   (i) the CSV header literally contains it, OR
 *   (ii) the column-synthesisers map registers a synthesiser for it.
 * Case (ii) is the Phase D0 follow-up shim — see column-synthesisers.mjs.
 */
export async function classifyTables(dir, manifest, schema) {
  const covered = [];
  const skippedNoModel = [];
  const skippedShape = [];
  const skippedNoCsv = [];

  for (const domain of TOPOLOGICAL_ORDER) {
    const domainModels = modelsByDomain().get(domain) ?? [];
    for (const datasetModel of domainModels) {
      const sjms5Model = schema.models.get(datasetModel);
      const table = resolveTableName(datasetModel, sjms5Model, manifest);
      const csvName = `${table}.csv`;
      const csvPath = path.join(dir, csvName);
      const manifestCount = manifest.rowCounts?.[table] ?? 0;

      if (!sjms5Model) {
        skippedNoModel.push({ domain, datasetModel, csvName, manifestCount });
        continue;
      }

      let csvExists = true;
      try {
        await stat(csvPath);
      } catch (err) {
        if (err.code === 'ENOENT') csvExists = false;
        else throw err;
      }
      if (!csvExists || manifestCount === 0) {
        skippedNoCsv.push({ domain, datasetModel, csvName, manifestCount });
        continue;
      }

      const headerCols = await readCsvHeader(csvPath);
      for (const c of headerCols) {
        if (FORBIDDEN_COLUMNS.has(c)) {
          throw new Error(`Snapshot ${csvName} contains forbidden column "${c}" — refusing to import`);
        }
      }

      const synthCols = synthesisableFields(datasetModel);

      const missingRequired = [];
      for (const field of sjms5Model.fields) {
        if (field.isOptional) continue;
        if (field.defaultExpr !== undefined) continue;
        if (headerCols.includes(field.name)) continue;
        if (synthCols.has(field.name)) continue;
        missingRequired.push(field.name);
      }
      if (missingRequired.length > 0) {
        skippedShape.push({
          domain, datasetModel, table, csvName, manifestCount, missingRequired,
        });
        continue;
      }

      const importableFields = sjms5Model.fields.filter(
        (f) => headerCols.includes(f.name) || synthCols.has(f.name),
      );
      covered.push({
        domain, datasetModel, table, csvName, csvPath, manifestCount, importableFields,
      });
    }
  }

  return { covered, skippedNoModel, skippedShape, skippedNoCsv };
}

/**
 * Resolve the manifest / CSV table name for a dataset model.
 *
 * Order of preference:
 *   1. SJMS-5 model's @@map (e.g. Person -> "persons") if the SJMS-5 schema
 *      knows the model. The dataset and SJMS-5 both descend from the same
 *      HE-data lineage, so @@map is usually a reliable match for the CSV
 *      filename the generator wrote.
 *   2. The manifest's snake_case_plural form, looked up against rowCounts
 *      (covers the "dataset has CSV, SJMS-5 has no model" case where
 *      sjms5Model is undefined).
 *   3. snake_case singular as the last-resort guess.
 */
export function resolveTableName(datasetModel, sjms5Model, manifest) {
  if (sjms5Model?.tableMap) return sjms5Model.tableMap;
  const fallbackSingular = toSnakeCase(datasetModel);
  const guessPlural = `${fallbackSingular}s`;
  if (manifest?.rowCounts?.[guessPlural] !== undefined) return guessPlural;
  if (manifest?.rowCounts?.[fallbackSingular] !== undefined) return fallbackSingular;
  return guessPlural;
}

function reportClassification(c) {
  const lines = [];
  lines.push(`\n=== Coverage report ===`);
  lines.push(`  covered:            ${c.covered.length} tables (${sumCounts(c.covered).toLocaleString()} rows)`);
  lines.push(`  skipped — no model: ${c.skippedNoModel.length} (dataset has CSV, SJMS-5 has no model)`);
  lines.push(`  skipped — shape:    ${c.skippedShape.length} (SJMS-5 requires a column the CSV lacks)`);
  lines.push(`  skipped — no csv:   ${c.skippedNoCsv.length} (SJMS-5 has model, snapshot has no rows)`);
  if (c.skippedShape.length > 0) {
    lines.push(`\n  Shape-incompatible tables (first 10):`);
    for (const t of c.skippedShape.slice(0, 10)) {
      lines.push(`    ${t.table.padEnd(40)} missing required: ${t.missingRequired.join(', ')}`);
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function sumCounts(list) {
  return list.reduce((acc, e) => acc + (e.manifestCount ?? 0), 0);
}

export async function upsertTableLive(prisma, entry, batchSize, synthCtx = {}) {
  const { table, csvPath, importableFields, manifestCount } = entry;
  const idField = importableFields.find((f) => f.isId);
  if (!idField) {
    throw new Error(`${table}: cannot upsert without an @id field`);
  }
  const modelDelegate = delegateFor(prisma, entry.datasetModel);
  if (!modelDelegate) {
    throw new Error(`${table}: Prisma client has no delegate for model "${entry.datasetModel}" — schema/client drift`);
  }

  let batch = [];
  let line = 1;
  let imported = 0;
  process.stdout.write(`  PERSIST: ${entry.domain.padEnd(18)} ${table.padEnd(40)} ${manifestCount.toLocaleString().padStart(10)} rows\n`);

  const flush = async () => {
    if (batch.length === 0) return;
    await prisma.$transaction(batch.map((row) => modelDelegate.upsert({
      where: { [idField.name]: row[idField.name] },
      create: row,
      update: row,
    })));
    imported += batch.length;
    batch = [];
  };

  const hasSynths = Boolean(COLUMN_SYNTHESISERS[entry.datasetModel]);
  for await (const raw of readCsvRows(csvPath)) {
    line += 1;
    const enriched = hasSynths ? applySynthesisers(entry.datasetModel, raw, synthCtx) : raw;
    const row = coerceRow(enriched, importableFields, { table, line });
    batch.push(row);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  return imported;
}

/**
 * Prisma delegate names are lowerCamelCase of the model name (e.g. `Person` -> `prisma.person`).
 * The dataset model names follow PascalCase; we lowercase the first letter.
 */
function delegateFor(prisma, modelName) {
  const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  return prisma[key];
}

export async function emitAuditEvent(prisma, manifest, importCounts) {
  await prisma.auditLog.create({
    data: {
      entityType: 'Dataset',
      entityId: manifest.generatedAt ?? new Date().toISOString(),
      action: 'CREATE',
      userId: null,
      userRole: 'system',
      newData: {
        manifest: {
          generatedAt: manifest.generatedAt,
          seed: manifest.seed,
          schemaHash: manifest.schemaHash,
          totalTables: manifest.totalTables,
          totalRows: manifest.totalRows,
        },
        importCounts,
      },
    },
  });
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));

  let dir = args.source;
  let cleanup = null;
  if (args.source.includes(':')) {
    dir = await syncFromRclone(args.source);
    cleanup = dir;
  }

  const manifest = await loadManifest(dir);
  const schema = await parsePrismaSchema(args.schemaPath);
  await describeManifest(manifest, schema.models.size);

  const classification = await classifyTables(dir, manifest, schema);
  reportClassification(classification);

  if (!args.persist) {
    process.stdout.write(`\n=== Plan (no --persist; no rows will be written) ===\n`);
    for (const entry of classification.covered) {
      process.stdout.write(
        `  PLAN: ${entry.domain.padEnd(18)} ${entry.table.padEnd(40)} ${entry.manifestCount.toLocaleString().padStart(10)} rows\n`,
      );
    }
    process.stdout.write(`\nScaffold complete. ${classification.covered.length} tables planned, ${classification.skippedNoModel.length + classification.skippedShape.length + classification.skippedNoCsv.length} skipped.\n`);
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
    return;
  }

  // Persist path — load Prisma client lazily so plan mode never needs it.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const importCounts = {};
  // Pre-load auxiliary lookups (academic-year ids → labels, person names)
  // that some column synthesisers need. Cheap one-shot pass at startup.
  const synthCtx = await loadSynthContext(dir);
  try {
    process.stdout.write(`\n=== Upsert (live) ===\n`);
    for (const entry of classification.covered) {
      importCounts[entry.table] = await upsertTableLive(prisma, entry, args.batch, synthCtx);
    }
    await emitAuditEvent(prisma, manifest, importCounts);
    process.stdout.write(`\nImport complete. ${classification.covered.length} tables, ${Object.values(importCounts).reduce((a, b) => a + b, 0).toLocaleString()} rows upserted.\n`);
  } finally {
    await prisma.$disconnect();
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`\nFATAL: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  });
}
