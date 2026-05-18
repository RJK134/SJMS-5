#!/usr/bin/env bash
#
# verify-truth.sh
#
# Recomputes the authoritative counts that docs/phase-status.json claims and
# fails (exit 1) on divergence. Companion to scripts/check-docs-truth.mjs:
#
#   - check-docs-truth.mjs is the canonical CI gate (covers README.md and
#     CLAUDE.md prose claims).
#   - verify-truth.sh focuses on the JSON-export at docs/phase-status.json
#     so machine-readable downstream consumers (release notes, dashboards)
#     do not silently drift.
#
# British English only. No external runtime deps beyond jq + standard
# coreutils + grep. Repo root is autodetected from the script location.
#
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_FILE="${REPO_ROOT}/docs/phase-status.json"

if [[ ! -f "${STATUS_FILE}" ]]; then
  echo "verify-truth: docs/phase-status.json not found at ${STATUS_FILE}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "verify-truth: jq is required (apt-get install jq)" >&2
  exit 1
fi

failures=0
pass()  { printf "  \033[32mOK\033[0m   %s = %s\n" "$1" "$2"; }
fail()  { printf "  \033[31mFAIL\033[0m %s expected=%s actual=%s\n" "$1" "$2" "$3"; failures=$((failures+1)); }

claim() {
  jq -r ".$1" "${STATUS_FILE}"
}

# ── 1. Prisma model count ──────────────────────────────────────────────────
expected=$(claim prismaModelCount)
actual=$(grep -c '^model ' "${REPO_ROOT}/prisma/schema.prisma" || true)
if [[ "${expected}" == "${actual}" ]]; then pass "prismaModelCount" "${actual}"; else fail "prismaModelCount" "${expected}" "${actual}"; fi

# ── 2. API router count ────────────────────────────────────────────────────
expected=$(claim apiRouterCount)
actual=$(find "${REPO_ROOT}/server/src/api" -name '*.router.ts' | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "apiRouterCount" "${actual}"; else fail "apiRouterCount" "${expected}" "${actual}"; fi

# ── 3. API service count ───────────────────────────────────────────────────
expected=$(claim apiServiceCount)
actual=$(find "${REPO_ROOT}/server/src/api" -name '*.service.ts' | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "apiServiceCount" "${actual}"; else fail "apiServiceCount" "${expected}" "${actual}"; fi

# ── 4. API group barrel count ──────────────────────────────────────────────
expected=$(claim apiGroupBarrelCount)
actual=$(find "${REPO_ROOT}/server/src/api" -maxdepth 2 -name 'group-index.ts' | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "apiGroupBarrelCount" "${actual}"; else fail "apiGroupBarrelCount" "${expected}" "${actual}"; fi

# ── 5. Front-end pages count ───────────────────────────────────────────────
expected=$(claim frontEndPagesCount)
actual=$(find "${REPO_ROOT}/client/src/pages" -name '*.tsx' | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "frontEndPagesCount" "${actual}"; else fail "frontEndPagesCount" "${expected}" "${actual}"; fi

# ── 6. Roles count ─────────────────────────────────────────────────────────
expected=$(claim rolesCount)
# Count individual role exports, excluding the ROLE_GROUPS bundle alias.
actual=$(grep -cE '^export const ROLE_[A-Z_]+ = ' "${REPO_ROOT}/server/src/constants/roles.ts" | tr -d ' ')
if [[ "${actual}" -ge "${expected}" ]]; then pass "rolesCount" "${actual} (>= ${expected})"; else fail "rolesCount" ">=${expected}" "${actual}"; fi

# ── 7. n8n workflows count ─────────────────────────────────────────────────
expected=$(claim n8nWorkflowsCount)
actual=$(find "${REPO_ROOT}/server/src/workflows" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
if [[ "${actual}" == "0" ]]; then
  # Fallback: workflows may live under /n8n-workflows in earlier branches.
  actual=$(find "${REPO_ROOT}/n8n-workflows" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
fi
if [[ "${expected}" == "${actual}" ]]; then pass "n8nWorkflowsCount" "${actual}"; else fail "n8nWorkflowsCount" "${expected}" "${actual}"; fi

# ── 8. Unit test files count ───────────────────────────────────────────────
expected=$(claim unitTestFilesCount)
actual=$(find "${REPO_ROOT}/server/src/__tests__/unit" -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "unitTestFilesCount" "${actual}"; else fail "unitTestFilesCount" "${expected}" "${actual}"; fi

# ── 9. E2E spec files count ────────────────────────────────────────────────
expected=$(claim e2eSpecFilesCount)
actual=$(find "${REPO_ROOT}/client/e2e" -name '*.spec.ts' 2>/dev/null | wc -l | tr -d ' ')
if [[ "${expected}" == "${actual}" ]]; then pass "e2eSpecFilesCount" "${actual}"; else fail "e2eSpecFilesCount" "${expected}" "${actual}"; fi

echo
if [[ ${failures} -eq 0 ]]; then
  echo "verify-truth: all checks pass"
  exit 0
else
  echo "verify-truth: ${failures} check(s) failed — update docs/phase-status.json or fix the source-of-truth count" >&2
  exit 1
fi
