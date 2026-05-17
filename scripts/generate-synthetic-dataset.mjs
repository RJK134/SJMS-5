#!/usr/bin/env node
/**
 * SJMS-5 synthetic dataset generator — entry point.
 *
 * Walks the 12 active generator domains in topological order, writes one
 * CSV per Prisma model to <outDir>/<table>.csv, then emits manifest.json.
 *
 * Usage:
 *   node scripts/generate-synthetic-dataset.mjs --out output/2026-05-17
 *   SJMS_DATASET_SEED=2026-05 node scripts/generate-synthetic-dataset.mjs
 *
 * CLI flags (see scripts/README.md for the full table):
 *   --out <dir>            Output directory (default: output/<today>)
 *   --seed <str>           RNG seed (default: $SJMS_DATASET_SEED or '2026-05')
 *   --only <domain,...>    Run only listed domains
 *   --skip <domain,...>    Skip listed domains
 *   --dry-run              Don't write CSVs, just compute row counts
 *   --scale <n>            Scale row counts by factor (default 1.0)
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRng } from './sjms-data/lib/rng.mjs';
import { parsePrismaSchema } from './sjms-data/lib/schema.mjs';
import { writeManifest } from './sjms-data/lib/manifest.mjs';
import { GeneratorContext } from './sjms-data/lib/context.mjs';
import {
  TOPOLOGICAL_ORDER,
  modelsByDomain,
  verifyCoverage,
} from './sjms-data/lib/domain-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.resolve(REPO_ROOT, '..', 'sjms-v4-integrated', 'prisma', 'schema.prisma');

function parseArgs(argv) {
  const args = { out: null, seed: null, only: null, skip: null, dryRun: false, scale: 1.0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--seed') args.seed = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',');
    else if (a === '--skip') args.skip = argv[++i].split(',');
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--scale') args.scale = parseFloat(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(helpText() + '\n');
      process.exit(0);
    }
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
  }
  args.out = args.out ?? `output/${new Date().toISOString().slice(0, 10)}`;
  args.seed = args.seed ?? process.env.SJMS_DATASET_SEED ?? '2026-05';
  return args;
}

function helpText() {
  return [
    'SJMS-5 synthetic dataset generator',
    '',
    'Usage: node scripts/generate-synthetic-dataset.mjs [flags]',
    '',
    '  --out <dir>            Output directory (default output/<today>)',
    '  --seed <str>           RNG seed (default $SJMS_DATASET_SEED or 2026-05)',
    '  --only <domain,...>    Run only listed domains',
    '  --skip <domain,...>    Skip listed domains',
    '  --dry-run              Compute row counts without writing CSVs',
    '  --scale <n>            Scale row counts by factor (default 1.0)',
    '  -h, --help             This text',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  process.stdout.write(`SJMS-5 dataset generator\n`);
  process.stdout.write(`  seed         ${args.seed}\n`);
  process.stdout.write(`  out          ${args.out}\n`);
  process.stdout.write(`  dryRun       ${args.dryRun}\n`);
  process.stdout.write(`  scale        ${args.scale}\n`);
  process.stdout.write(`  schemaPath   ${SCHEMA_PATH}\n`);

  // 1. Load and verify schema coverage
  const schema = await parsePrismaSchema(SCHEMA_PATH);
  process.stdout.write(`  schema       ${schema.models.size} models\n`);
  const coverage = verifyCoverage([...schema.models.keys()]);
  if (coverage.missing.length || coverage.extra.length) {
    process.stderr.write(`\nFATAL: schema/domain-map mismatch.\n`);
    if (coverage.missing.length) {
      process.stderr.write(`  in schema, not assigned to a domain:\n`);
      for (const m of coverage.missing) process.stderr.write(`    ${m}\n`);
    }
    if (coverage.extra.length) {
      process.stderr.write(`  assigned to a domain, not in schema:\n`);
      for (const m of coverage.extra) process.stderr.write(`    ${m}\n`);
    }
    process.exit(1);
  }

  // 2. Prepare output dir
  if (!args.dryRun) await mkdir(args.out, { recursive: true });

  // 3. Build context
  const rng = makeRng(args.seed);
  const ctx = new GeneratorContext({
    rng, outDir: args.out, schema, dryRun: args.dryRun, scale: args.scale,
  });

  // 4. Run generators in topological order
  const onlyFilter = args.only ? new Set(args.only) : null;
  const skipFilter = args.skip ? new Set(args.skip) : new Set();

  for (const domain of TOPOLOGICAL_ORDER) {
    if (onlyFilter && !onlyFilter.has(domain)) continue;
    if (skipFilter.has(domain)) continue;
    const t0 = Date.now();
    ctx.log(domain, `started`);
    const mod = await import(`./sjms-data/generators/${domain}.mjs`);
    if (typeof mod.generate !== 'function') {
      throw new Error(`Generator ${domain}.mjs does not export generate()`);
    }
    await mod.generate(ctx);
    ctx.log(domain, `done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  }

  // 5. Manifest
  if (!args.dryRun) {
    const manifest = await writeManifest({
      outDir: args.out,
      seed: args.seed,
      schemaPath: SCHEMA_PATH,
      schemaModelCount: schema.models.size,
      rowCounts: ctx.rowCounts,
      startedAt,
    });
    process.stdout.write(`\nWrote manifest: ${manifest.totalTables} tables / ${manifest.totalRows.toLocaleString()} rows\n`);
  }

  const totalRows = [...ctx.rowCounts.values()].reduce((s, n) => s + n, 0);
  process.stdout.write(`\nGenerator finished: ${ctx.rowCounts.size} tables / ${totalRows.toLocaleString()} rows\n`);
}

main().catch((err) => {
  process.stderr.write(`\nFATAL: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
