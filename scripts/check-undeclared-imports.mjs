#!/usr/bin/env node
// Undeclared-import guardrail
//
// Walks server/src and client/src looking for `import ... from 'pkg'` /
// `require('pkg')` statements that resolve to bare npm packages, and
// verifies each one appears as a dependency or devDependency in the
// nearest workspace package.json (or the root package.json).
//
// This script exists because Phase 1C surfaced a class of bug we want
// CI to catch automatically: PR #74 silently removed `bullmq` from
// `server/package.json` even though `server/src/utils/queue.ts` still
// imported it. Hoisted node_modules from a hoisted root install masked
// the issue locally; CI's `npm ci` (which only installs declared deps
// + their transitives) blew up only on the next PR that touched
// anything triggering a fresh install.
//
// Exit codes:
//   0 — every bare import is declared somewhere reachable
//   1 — one or more bare imports have no declaring package.json
//
// Usage:
//   node scripts/check-undeclared-imports.mjs
//
// Wire as an advisory CI step today (low blast radius — false positives
// are rare and easy to fix), ratchet to blocking once it's been clean
// for a couple of Phase 1 / Phase 3 batches.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');

// Node built-ins — never need to be declared in package.json.
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'dns', 'domain', 'events',
  'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module',
  'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'stream/promises', 'stream/web', 'string_decoder', 'sys', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util',
  'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const findings = [];

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function readDeclared(pkgRel) {
  const pkgPath = join(repoRoot, pkgRel);
  if (!existsSync(pkgPath)) return new Set();
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);
}

function walk(dir, predicate) {
  const out = [];
  function recurse(d) {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      const full = join(d, entry);
      const s = statSync(full);
      if (s.isDirectory()) recurse(full);
      else if (predicate(full)) out.push(full);
    }
  }
  recurse(join(repoRoot, dir));
  return out;
}

// Match `import ... from 'pkg'` and `require('pkg')` for bare package
// names only. Skips relative paths (./, ../), absolute paths (/), and
// the `node:builtin` prefix (which is checked separately below).
const IMPORT_REGEX =
  /(?:from|require\(|import\s*\()\s*['"`]([@a-z][a-z0-9._\-/]*)['"`]/g;

function stripComments(text) {
  // Strip /* ... */ block comments first (greedy across newlines), then
  // every line-comment tail (`// ...` or JSDoc-continuation `* ...`).
  // Crude but sufficient for source-tree scanning — a real parser would
  // be overkill for this guardrail.
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
      // Drop trailing `// ...` from a line of real code.
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      // Don't strip inside a string literal — quick heuristic: only
      // strip if there's no unmatched quote on the LHS.
      const lhs = line.slice(0, idx);
      const quotes = (lhs.match(/['"`]/g) || []).length;
      if (quotes % 2 === 0) return lhs;
      return line;
    })
    .join('\n');
  return out;
}

function extractBareImports(text) {
  const cleaned = stripComments(text);
  const seen = new Set();
  for (const m of cleaned.matchAll(IMPORT_REGEX)) {
    const spec = m[1];
    // Skip relative + absolute paths
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    // Skip explicit node: builtins
    if (spec.startsWith('node:')) continue;
    // Skip vite alias '@/...' if any client setups use it
    if (spec.startsWith('@/')) continue;
    // Normalise to top-level package name:
    //   @scope/pkg/sub → @scope/pkg
    //   pkg/sub        → pkg
    let pkg;
    if (spec.startsWith('@')) {
      const parts = spec.split('/');
      if (parts.length < 2) continue; // malformed @scope only — skip
      pkg = `${parts[0]}/${parts[1]}`;
    } else {
      pkg = spec.split('/')[0];
    }
    // Skip Node built-ins by bare name (e.g. `import 'crypto'`)
    if (NODE_BUILTINS.has(pkg)) continue;
    seen.add(pkg);
  }
  return seen;
}

function check(workspace) {
  const workspaceDeclared = readDeclared(`${workspace}/package.json`);
  const rootDeclared = readDeclared('package.json');
  const allDeclared = new Set([...workspaceDeclared, ...rootDeclared]);

  const sourceFiles = walk(`${workspace}/src`, (p) =>
    p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.mjs') || p.endsWith('.js'),
  );

  const undeclared = new Map(); // pkg → [files]
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pkg of extractBareImports(text)) {
      if (!allDeclared.has(pkg)) {
        const list = undeclared.get(pkg) ?? [];
        list.push(file.replace(repoRoot + '/', ''));
        undeclared.set(pkg, list);
      }
    }
  }

  if (undeclared.size === 0) {
    process.stdout.write(`✓ ${workspace}: every bare import is declared (${sourceFiles.length} files scanned)\n`);
    return;
  }

  for (const [pkg, files] of undeclared) {
    findings.push({ workspace, pkg, files: files.slice(0, 3) });
  }
}

// Also scan scripts/ — it's not a workspace but it does import packages
// (notably @prisma/client, tsx, zod) that live in the root package.json,
// and the scripts/test/*.test.mjs suite imports `vitest` which is
// declared in server/devDependencies. Allow any workspace to satisfy
// scripts/ imports since the runner resolves through the hoisted tree.
function checkScripts() {
  const allDeclared = new Set([
    ...readDeclared('package.json'),
    ...readDeclared('server/package.json'),
    ...readDeclared('client/package.json'),
  ]);
  const sourceFiles = walk('scripts', (p) =>
    p.endsWith('.ts') || p.endsWith('.mjs') || p.endsWith('.js'),
  );

  const undeclared = new Map();
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pkg of extractBareImports(text)) {
      if (!allDeclared.has(pkg)) {
        const list = undeclared.get(pkg) ?? [];
        list.push(file.replace(repoRoot + '/', ''));
        undeclared.set(pkg, list);
      }
    }
  }

  if (undeclared.size === 0) {
    process.stdout.write(`✓ scripts: every bare import is declared (${sourceFiles.length} files scanned)\n`);
    return;
  }

  for (const [pkg, files] of undeclared) {
    findings.push({ workspace: 'scripts', pkg, files: files.slice(0, 3) });
  }
}

check('server');
check('client');
checkScripts();

if (findings.length === 0) {
  process.stdout.write('\nAll bare imports are declared in a reachable package.json.\n');
  process.exit(0);
}

process.stderr.write(`\n${findings.length} undeclared import${findings.length === 1 ? '' : 's'}:\n`);
for (const f of findings) {
  process.stderr.write(`  ✗ ${f.workspace}: '${f.pkg}'\n`);
  process.stderr.write(`      first seen in:\n`);
  for (const file of f.files) {
    process.stderr.write(`        - ${file}\n`);
  }
  process.stderr.write(`      add to ${f.workspace}/package.json (or root) and re-lock.\n`);
}
process.exit(1);
