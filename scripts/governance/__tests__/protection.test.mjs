#!/usr/bin/env node
// Validation test for scripts/governance/protection.json.
//
// Runs in plain Node (no external test runner) so it can be invoked
// from CI without pulling test deps. Exits 0 when every assertion
// passes; exits 1 with a structured failure list otherwise.
//
// Each assertion below maps to a numbered clause in GOVERNANCE.md so a
// failure points the reader at the policy decision the JSON has
// drifted from.
//
// Usage:
//   node scripts/governance/__tests__/protection.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..', '..', '..');
const policyPath = resolve(repoRoot, 'scripts/governance/protection.json');

const failures = [];
function expect(name, predicate, hint) {
  if (predicate) {
    process.stdout.write(`  \x1b[32mOK\x1b[0m   ${name}\n`);
  } else {
    process.stdout.write(`  \x1b[31mFAIL\x1b[0m ${name}\n`);
    failures.push({ name, hint });
  }
}

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

// --- Clause 1: default branch is main ---
expect(
  'targets the default branch (main)',
  policy.branch === 'main',
  'GOVERNANCE.md ï¿½1 requires the policy apply to main; if the default branch changes the policy must too.',
);

// --- Clause 2: required reviewers ---
expect(
  'requires at least two approving reviews (Phase 0 batch 0K â bus-factor)',
  typeof policy.required_pull_request_reviews?.required_approving_review_count === 'number' &&
    policy.required_pull_request_reviews.required_approving_review_count >= 2,
  'GOVERNANCE.md Â§2 + docs/operations/ci-and-branch-protection.md Â§2 require 2 approving CODEOWNERS reviews from Phase 0 close (deep-review P0 #6 bus-factor).',
);
expect(
  'dismisses stale reviews on push',
  policy.required_pull_request_reviews?.dismiss_stale_reviews === true,
  'GOVERNANCE.md ï¿½2 forbids approvals from surviving a force-push.',
);
expect(
  'requires CODEOWNERS review',
  policy.required_pull_request_reviews?.require_code_owner_reviews === true,
  'GOVERNANCE.md ï¿½2 ties approval to CODEOWNERS.',
);
expect(
  'requires last-push approval (no self-approve after rewrite)',
  policy.required_pull_request_reviews?.require_last_push_approval === true,
  'GOVERNANCE.md ï¿½2 forbids re-approval bypass after a rewrite.',
);

// --- Clause 3: required status checks ---
expect(
  'has required_status_checks block',
  policy.required_status_checks && typeof policy.required_status_checks === 'object',
  'GOVERNANCE.md ï¿½3 requires the policy enumerate the blocking checks.',
);
expect(
  'required checks are strict (branch must be up-to-date)',
  policy.required_status_checks?.strict === true,
  'GOVERNANCE.md ï¿½3 enforces strict mode.',
);
const requiredContexts = policy.required_status_checks?.contexts ?? [];
// Ratcheted in Phase 0 batch 0K. The pre-0K policy listed the
// SJMS-2.5 aggregate "Quality gate" check; SJMS-5 splits that into
// the per-workspace checks below and adds the supply-chain hardening
// checks landed in batch 0M (Trivy Ã 2, SBOM) plus npm audit ratched
// from advisory and CodeQL by its workflow-job name.
for (const ctx of [
  'Docs truth check',
  'Server quality gate',
  'Client quality gate',
  'governance-drift',
  'GitGuardian Security Checks',
  'Analyze javascript-typescript',
  'Trivy â API image',
  'Trivy â client image',
  'Generate CycloneDX SBOM (root + server + client)',
  'npm audit',
]) {
  expect(
    `requires status check: ${ctx}`,
    requiredContexts.includes(ctx),
    `docs/operations/ci-and-branch-protection.md Â§2 lists ${ctx} as required.`,
  );
}

// --- Clause 4: branch protection summary ---
expect(
  'enforces admins (no admin bypass)',
  policy.enforce_admins === true,
  'GOVERNANCE.md ï¿½4 + ï¿½6: admin bypass is replaced by the break-glass procedure.',
);
expect(
  'requires signed commits',
  policy.required_signatures === true,
  'GOVERNANCE.md ï¿½5 requires cryptographic signing.',
);
expect(
  'requires linear history',
  policy.required_linear_history === true,
  'GOVERNANCE.md ï¿½4: only squash-merge is allowed.',
);
expect(
  'requires conversation resolution before merge',
  policy.required_conversation_resolution === true,
  'GOVERNANCE.md ï¿½4: unresolved review threads block merge.',
);
expect(
  'forbids force pushes',
  policy.allow_force_pushes === false,
  'GOVERNANCE.md ï¿½4: force-push is disallowed on main.',
);
expect(
  'forbids deletions',
  policy.allow_deletions === false,
  'GOVERNANCE.md ï¿½4: main cannot be deleted.',
);

// --- Result ---
process.stdout.write('\n');
if (failures.length === 0) {
  process.stdout.write('protection.test: all checks pass\n');
  process.exit(0);
}
process.stderr.write(`protection.test: ${failures.length} check(s) failed\n`);
for (const f of failures) {
  process.stderr.write(`  - ${f.name}\n      hint: ${f.hint}\n`);
}
process.exit(1);
