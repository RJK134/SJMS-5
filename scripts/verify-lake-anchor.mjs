#!/usr/bin/env node
/**
 * verify-lake-anchor.mjs — independent tamper-detection check.
 *
 * Pulls a lake snapshot's manifest.json, computes its sha256, then
 * looks up the matching anchor record in the public gist
 * (sjms-5-dataset-anchors.jsonl). If the recorded hash disagrees with
 * the computed one, the lake snapshot has been altered after the
 * anchor was captured.
 *
 * Usage:
 *   node scripts/verify-lake-anchor.mjs --source gdrive5tb:sjms-5-dataset/latest/
 *   node scripts/verify-lake-anchor.mjs --source ./output/2026-05-17/
 *   node scripts/verify-lake-anchor.mjs --source ./output/2026-05-17/ --gist-url https://gist.github.com/<user>/<id>
 *
 * Exit codes:
 *   0  — manifest hash matches recorded anchor
 *   1  — mismatch (lake tampered OR anchor disagrees, surface to operator)
 *   2  — anchor not found (nothing to compare against)
 *   3  — usage / IO error
 */

import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_GIST_URL = process.env.SJMS_ANCHOR_GIST_URL ?? null;

function parseArgs(argv) {
  const args = { source: null, gistUrl: DEFAULT_GIST_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--gist-url') args.gistUrl = argv[++i];
    else if (a === '-h' || a === '--help') {
      process.stdout.write(helpText() + '\n');
      process.exit(0);
    }
  }
  if (!args.source) {
    process.stderr.write('--source is required\n');
    process.exit(3);
  }
  if (!args.gistUrl) {
    process.stderr.write('--gist-url is required (or set SJMS_ANCHOR_GIST_URL)\n');
    process.exit(3);
  }
  return args;
}

function helpText() {
  return `Verify a lake snapshot's manifest against the public anchor gist.

Usage: node scripts/verify-lake-anchor.mjs --source <path> [--gist-url <url>]

  --source <path>     Lake URL (gdrive5tb:...) or local snapshot directory
  --gist-url <url>    Public gist with anchor records (or set SJMS_ANCHOR_GIST_URL)
  -h, --help          This text

Exits 0 if the recorded anchor matches; 1 if it disagrees; 2 if no
anchor exists for this manifest.`;
}

async function syncFromRclone(remote) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sjms5-verify-'));
  process.stdout.write(`Pulling ${remote} → ${dir} …\n`);
  await new Promise((resolve, reject) => {
    const child = spawn('rclone', ['copy', `${remote}manifest.json`, dir, '--quiet'], { stdio: 'inherit' });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`rclone exit ${code}`)));
  });
  return dir;
}

async function sha256File(p) {
  const data = await readFile(p);
  return createHash('sha256').update(data).digest('hex');
}

async function fetchAnchors(gistUrl) {
  // Resolve gist URL → raw JSONL. The public gist URL has the form
  // https://gist.github.com/<user>/<id>; the raw URL is
  // https://gist.githubusercontent.com/<user>/<id>/raw/sjms-5-dataset-anchors.jsonl
  const m = gistUrl.match(/^https:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/);
  if (!m) {
    process.stderr.write(`Unexpected gist URL shape: ${gistUrl}\n`);
    process.exit(3);
  }
  const [, user, id] = m;
  const rawUrl = `https://gist.githubusercontent.com/${user}/${id}/raw/sjms-5-dataset-anchors.jsonl`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    process.stderr.write(`gist fetch failed: ${res.status} ${res.statusText}\n`);
    process.exit(3);
  }
  const body = await res.text();
  return body.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let dir = args.source;
  let cleanup = null;
  if (args.source.includes(':')) {
    dir = await syncFromRclone(args.source);
    cleanup = dir;
  }

  const manifestPath = path.join(dir, 'manifest.json');
  try {
    await stat(manifestPath);
  } catch {
    process.stderr.write(`No manifest.json at ${manifestPath}\n`);
    process.exit(3);
  }

  const manifestSha = await sha256File(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  process.stdout.write(`Lake manifest sha256: ${manifestSha}\n`);
  process.stdout.write(`  schemaHash:  ${manifest.schemaHash}\n`);
  process.stdout.write(`  totalRows:   ${manifest.totalRows.toLocaleString()}\n`);
  process.stdout.write(`  totalTables: ${manifest.totalTables}\n`);

  const anchors = await fetchAnchors(args.gistUrl);
  process.stdout.write(`\nFetched ${anchors.length} anchor record(s) from gist.\n`);

  const match = anchors.find((a) => a.manifestSha256 === manifestSha);
  if (!match) {
    const recent = anchors.slice(-3).map((a) => `  ${a.anchoredAt}  ${a.manifestSha256.slice(0, 12)}  ${a.manifestPath}`).join('\n');
    process.stderr.write(`\nNo anchor matches manifest sha256 ${manifestSha}.\n`);
    process.stderr.write(`Most recent anchors:\n${recent}\n`);
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
    process.exit(2);
  }

  process.stdout.write(`\nAnchor MATCH:\n`);
  process.stdout.write(`  anchoredAt:  ${match.anchoredAt}\n`);
  process.stdout.write(`  gitSha:      ${match.gitSha}\n`);
  process.stdout.write(`  schemaHash:  ${match.schemaHash}\n`);
  if (match.schemaHash !== manifest.schemaHash) {
    process.stderr.write(`\nWARNING: schemaHash field disagrees between manifest and anchor.\n`);
    if (cleanup) await rm(cleanup, { recursive: true, force: true });
    process.exit(1);
  }
  process.stdout.write(`\nOK — lake snapshot is consistent with the public anchor.\n`);
  if (cleanup) await rm(cleanup, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err.message}\n`);
  process.exit(3);
});
