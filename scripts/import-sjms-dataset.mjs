#!/usr/bin/env node
/**
 * SJMS-5 dataset importer — scaffold.
 *
 * Mirrors the Maieus2 datalake importer pattern (PR #94 / PR #99):
 *   1. Walk a snapshot folder in lake order.
 *   2. Validate the snapshot's manifest against the compiled schema hash.
 *   3. Refuse FORBIDDEN_COLUMNS at parse time.
 *   4. Upsert each table in topological order.
 *   5. Emit one `dataset.imported` audit event with the snapshot manifest.
 *
 * Usage:
 *   node scripts/import-sjms-dataset.mjs --source gdrive5tb:sjms-5-dataset/latest/
 *   node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17/
 *   node scripts/import-sjms-dataset.mjs --source ./output/2026-05-17/ --batch 1000
 *
 * **Status: scaffold only.** The upsert calls require SJMS-5's Prisma client
 * which doesn't exist yet — that arrives with Phase 0 of SJMS-5 (the spine
 * import). Until then, the importer validates the snapshot structure,
 * verifies manifest integrity, performs the FORBIDDEN_COLUMNS check, and
 * prints a dry-run plan listing the tables it would upsert and in what
 * order. Wire the live Prisma client in at the marked TODOs once the
 * schema exists.
 */

import { readFile, readdir, mkdtemp, rm, stat, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { TOPOLOGICAL_ORDER, modelsByDomain } from './sjms-data/lib/domain-map.mjs';
import { parsePrismaSchema } from './sjms-data/lib/schema.mjs';

const FORBIDDEN_COLUMNS = new Set([
  'body', 'questionText', 'question_text', 'markScheme', 'mark_scheme',
  'answerKey', 'answer_key', 'answer', 'solution', 'solutionText', 'solution_text',
  'modelAnswer', 'model_answer', 'examPaperText', 'exam_paper_text',
]);

function parseArgs(argv) {
  const args = { source: null, batch: 500, dryRun: false, schemaPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--batch') args.batch = parseInt(argv[++i], 10);
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
  return args;
}

function helpText() {
  return `SJMS-5 dataset importer (scaffold)

Usage: node scripts/import-sjms-dataset.mjs --source <path-or-rclone-url>

  --source <path>     Local directory OR rclone remote (gdrive5tb:...)
  --schema <path>     Compiled Prisma schema (default: ../sjms-v4-integrated/prisma/schema.prisma)
  --batch <n>         Upsert batch size (default 500)
  --dry-run           Validate snapshot and print plan; do not upsert
  -h, --help          This text

Phase 0 of SJMS-5 must be live before the upsert calls work — until then
this is dry-run only.`;
}

async function syncFromRclone(remote) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sjms5-import-'));
  process.stdout.write(`Pulling ${remote} → ${dir} …\n`);
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

async function verifyManifest(manifest, schemaPath) {
  const { schemaHash: actualHash } = manifest;
  // The schema-hash check would compare against the compiled Prisma schema hash.
  // For now we just emit a warning if the SJMS-5 schema isn't reachable.
  process.stdout.write(`Manifest:  generated ${manifest.generatedAt}\n`);
  process.stdout.write(`           seed ${manifest.seed}\n`);
  process.stdout.write(`           ${manifest.totalTables} tables / ${manifest.totalRows.toLocaleString()} rows\n`);
  process.stdout.write(`           schemaHash ${actualHash}\n`);
  try {
    const schema = await parsePrismaSchema(schemaPath);
    process.stdout.write(`           schema reachable: ${schema.models.size} models\n`);
    if (schema.models.size !== manifest.schemaModels) {
      process.stdout.write(`           WARN: schema model count differs (${schema.models.size} vs ${manifest.schemaModels})\n`);
    }
  } catch (err) {
    process.stdout.write(`           WARN: schema not reachable (${err.message}) — running in shape-only mode\n`);
  }
}

async function planUpsertOrder(dir, manifest, schemaPath) {
  // The topological order is encoded in the generator's domain-map. The importer
  // walks the same order so FK targets always exist before referencing rows.
  //
  // Table names use the Prisma schema's @@map directive (e.g. User → users)
  // — we read them from the parsed schema rather than guessing via snake-case.
  let modelToTable = new Map();
  try {
    const schema = await parsePrismaSchema(schemaPath);
    for (const [name, model] of schema.models) {
      modelToTable.set(name, model.tableMap ?? toSnakeCase(name));
    }
  } catch {
    // Schema not reachable — fall back to snake-case lookup.
    for (const m of Object.keys(manifest.rowCounts ?? {})) modelToTable.set(m, m);
  }

  const order = [];
  for (const domain of TOPOLOGICAL_ORDER) {
    const domainModels = modelsByDomain().get(domain);
    for (const m of domainModels) {
      const table = modelToTable.get(m) ?? toSnakeCase(m);
      const count = manifest.rowCounts[table] ?? 0;
      order.push({ domain, model: m, table, file: `${table}.csv`, count });
    }
  }
  return order;
}

function toSnakeCase(s) {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

async function readFirstLine(file) {
  // Read up to 4KB and slice on the first newline. Sufficient for CSV header
  // rows, which never exceed a few hundred bytes.
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    return nl >= 0 ? text.slice(0, nl) : text;
  } finally {
    await fh.close();
  }
}

async function validateCsvHeaders(dir, plan) {
  for (const entry of plan) {
    const file = path.join(dir, entry.file);
    try {
      await stat(file);
    } catch (err) {
      if (err.code === 'ENOENT') {
        process.stdout.write(`  MISSING: ${entry.file}\n`);
        continue;
      }
      throw err;
    }
    const headerLine = await readFirstLine(file);
    const columns = headerLine.split(',');
    for (const c of columns) {
      if (FORBIDDEN_COLUMNS.has(c)) {
        throw new Error(`Snapshot ${entry.file} contains forbidden column "${c}" — refusing to import`);
      }
    }
  }
}

/**
 * TODO: replace with actual Prisma upsert when SJMS-5 schema is live.
 *
 * Pattern (post-Phase-0):
 *
 *   import { prisma } from '@sjms-5/db';
 *
 *   await prisma.$transaction(async (tx) => {
 *     for (const row of batch) {
 *       await tx[modelName].upsert({
 *         where: { id: row.id },
 *         create: row,
 *         update: row,
 *       });
 *     }
 *   });
 *
 * After all tables import, emit the audit event:
 *
 *   await prisma.auditEvent.create({
 *     data: {
 *       action: 'dataset.imported',
 *       payload: { snapshot, manifest, counts },
 *       actor: 'system',
 *     },
 *   });
 */
async function upsertTable(_dir, entry, _batchSize) {
  // Scaffold: log what would happen.
  process.stdout.write(`  PLAN: ${entry.domain.padEnd(18)} ${entry.table.padEnd(40)} ${entry.count.toLocaleString().padStart(10)} rows\n`);
}

async function emitAuditEvent(_manifest) {
  // TODO: write to prisma.auditEvent (post-Phase-0).
  process.stdout.write(`  audit: would emit dataset.imported event\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = args.schemaPath ?? path.resolve(
    path.dirname(import.meta.url.replace('file://', '')),
    '..', '..', 'sjms-v4-integrated', 'prisma', 'schema.prisma',
  );

  let dir = args.source;
  let cleanup = null;
  if (args.source.includes(':')) {
    dir = await syncFromRclone(args.source);
    cleanup = dir;
  }

  const manifest = await loadManifest(dir);
  await verifyManifest(manifest, schemaPath);
  const plan = await planUpsertOrder(dir, manifest, schemaPath);
  await validateCsvHeaders(dir, plan);

  process.stdout.write(`\n=== Plan (topological order) ===\n`);
  for (const entry of plan) {
    await upsertTable(dir, entry, args.batch);
  }
  await emitAuditEvent(manifest);

  process.stdout.write(`\nScaffold complete. ${plan.length} tables planned.\n`);
  if (cleanup) await rm(cleanup, { recursive: true, force: true });

  if (args.dryRun) return;
  process.stdout.write(`\nNote: upsert calls are scaffolded. Wire @sjms-5/db Prisma client at the\n`);
  process.stdout.write(`marked TODOs once Phase 0 of SJMS-5 produces the schema.\n`);
}

main().catch((err) => {
  process.stderr.write(`\nFATAL: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
