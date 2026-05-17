/**
 * Manifest writer — produces manifest.json at the end of every generator run.
 *
 * Importer-side contract:
 *   - generatedAt    ISO 8601 timestamp the run started
 *   - seed           the SJMS_DATASET_SEED value (for repro)
 *   - generatorCommit short SHA of the generator at run-time (best-effort)
 *   - schemaHash     SHA-256 of the source Prisma schema — importer rejects
 *                    snapshots whose hash does not match its compiled schema
 *   - schemaModels   count of models in the source schema (sanity)
 *   - rowCounts      { tableName: number }
 *   - governanceCounts / financeCounts — extracted from rowCounts for quick
 *                    operator visibility on the brief's domain expectations
 *   - generatorVersion semver of this package
 */

import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

const GENERATOR_VERSION = '0.1.0';

const GOVERNANCE_TABLES = new Set([
  'faculties', 'departments', 'department_cost_centres', 'committees',
  'committee_members', 'committee_meetings', 'committee_action_items',
  'student_organisations', 'student_org_memberships', 'student_org_events',
]);

const FINANCE_TABLES = new Set([
  'fees', 'invoices', 'payments', 'payment_transactions', 'payment_plans',
  'sponsor_records', 'sponsor_payments', 'bursary_funds', 'bursary_applications',
  'funding_applications', 'debts', 'refunds', 'slc_loans',
  'slc_payment_notifications', 'slc_fee_assessments',
  'apprenticeship_funding_claims',
]);

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function schemaHash(schemaPath) {
  const src = await readFile(schemaPath, 'utf8');
  return createHash('sha256').update(src).digest('hex');
}

export async function writeManifest({
  outDir,
  seed,
  schemaPath,
  schemaModelCount,
  rowCounts,
  startedAt,
}) {
  const counts = Object.fromEntries(rowCounts);
  const governanceCounts = {};
  const financeCounts = {};
  for (const [t, n] of Object.entries(counts)) {
    if (GOVERNANCE_TABLES.has(t)) governanceCounts[t] = n;
    if (FINANCE_TABLES.has(t)) financeCounts[t] = n;
  }

  const manifest = {
    generatorVersion: GENERATOR_VERSION,
    generatorCommit: gitShortSha(),
    generatedAt: startedAt,
    finishedAt: new Date().toISOString(),
    seed,
    schemaHash: await schemaHash(schemaPath),
    schemaModels: schemaModelCount,
    totalTables: Object.keys(counts).length,
    totalRows: Object.values(counts).reduce((s, n) => s + n, 0),
    rowCounts: counts,
    governanceCounts,
    financeCounts,
  };

  const target = path.join(outDir, 'manifest.json');
  await writeFile(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}
