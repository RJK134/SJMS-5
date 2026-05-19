# Phase 0 — Spine Import

> **Status:** scaffolded; bootstrap pending operator trigger.
>
> **Branch:** `phase-0/spine-import` (created by the bootstrap workflow on first run).
>
> **Source plan:** [`docs/SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) Phase 0 section.
>
> **Domain lead:** [`docs/skills-leads/01-phase-0-spine-import.md`](../skills-leads/01-phase-0-spine-import.md).

## Why a workflow rather than push_files

The SJMS-2.5 spine is **976 files / 62 MB** (435 .ts, 161 .tsx, 250 .md, 50 .json + others; after excluding the 30 MB Perplexity PDF and HTML export download artefacts, ~970 files / 47 MB).

The GitHub MCP `push_files` API used by Claude can carry ~10–20 files per call without hitting payload or context limits. Importing the spine via `push_files` would mean ~50–100 commits across multiple sessions, with substantial context-token cost. The cleanest path is a one-shot server-side `git clone` performed by a GitHub Action.

## How to bootstrap

This is **operator-driven**, one-off, takes ~2 minutes.

1. **Merge the bootstrap workflow chore PR** (`chore/phase-0-bootstrap-workflow`) so the workflow lives on `main`.
2. Open **Actions** tab on `RJK134/SJMS-5` → select **"Phase 0A — Bootstrap SJMS-2.5 spine"** workflow.
3. Click **"Run workflow"**. In the input field, type `CONFIRM` (exact case). Leave `source_ref` as `main` unless bootstrapping from a specific SJMS-2.5 tag.
4. The workflow runs for ~1–2 minutes. On success, branch `phase-0/spine-import` exists on `RJK134/SJMS-5` carrying the full SJMS-2.5 spine + the existing SJMS-5 planning docs from `main`.
5. The Phase 0 PR opens automatically against this branch (or Claude opens it next session).

## What the workflow does

1. Clones `RJK134/SJMS-2.5@{source_ref}` (public, no auth).
2. Checks out `RJK134/SJMS-5@main` as the working base.
3. Creates `phase-0/spine-import` branch from main.
4. `rsync` copies SJMS-2.5 contents onto SJMS-5's main, **excluding**:
   - `.git/` (source repo metadata)
   - `.claude/worktrees/`, `.claude/*.txt` (KI-S5-316 hygiene)
   - `node_modules/` (defensive)
   - `docs/Complete Perplexity How to Build A SJMS.pdf` (30 MB reference)
   - `docs/*_files/` (HTML export download artefacts)
   - All SJMS-5 planning docs already on main (preserved as-is)
   - `docs/skills-leads/` (preserved as-is)
   - `README.md` (preserved on main; rebranded in batch 0A2)
5. Stages, commits with a detailed conventional-commit message, and `git push --force-with-lease` to `phase-0/spine-import`.
6. Writes a step summary with file counts and next steps.

## What the workflow does NOT do

- **No rebrand.** Source files keep their original SJMS-2.5 references. Rebrand is **batch 0A2** — a separate, reviewable Claude commit covering `package.json` name, `CLAUDE.md` header, `docker-compose.yml` container names, repo URL references, Vercel project name, and `docs:check` expected counts. The surgical-diff is the audit point.
- **No 18B/18C finance work.** That's batch 0B (separate import of the SJMS-2.5 `claude/phase-18b-invoice-generation` and `claude/phase-18c-payment-allocation` branches as sub-commits).
- **No outbox.** The transactional outbox + worker is the load-bearing batch 0L; cannot be retrofitted into 0A.
- **No supply-chain hardening.** Batch 0M.
- **No MFA, no JWT-fallback removal, no n8n header fix.** Batches 0G, 0F, 0H respectively.

## Batch tracker

| Batch | Title | Status |
|---|---|---|
| 0A1 | Bootstrap SJMS-2.5 spine via GitHub Action | **DONE 2026-05-18** — PR #34 (token fix) + workflow run 26057111322 → branch `phase-0/spine-import` created at commit `7d0c6ac` |
| 0A2 | Rebrand (package.json, CLAUDE.md, container names, URLs, Vercel project, docs:check) | **DONE 2026-05-18** — PR #38, 23 files / +60 / −56 |
| 0B | Import 2.5 18B + 18C finance work as sub-commits | **DONE 2026-05-18 (no-op)** — 18B + 18C (and 18D) already merged into SJMS-2.5/`main` before 0A1 fired; the spine import captured them. `git diff sjms25/main phase-0/spine-import -- server/src/` is empty. All 9 finance test files present (28 + 21 + 21 + 20 pure-function tests in `fee-calculation` / `invoice-composition` / `payment-allocation` / `payment-plan-schedule` plus 16 + 16 + 35 + 13 + 25 service-orchestration tests in `fee-assessments` / `invoices` / `payments` / `payment-plans` / `payment-instalments` services). Test-suite execution moved to 0I where the full CI baseline runs. |
| 0C | MinIO + AES-256-GCM + cryptobox (extends secrets-at-rest) | not started |
| 0D | BullMQ + Redis worker pattern | not started |
| 0E | k6 scenarios | **IN FLIGHT** — PR #67 (rebased replacement for closed #46) |
| 0F | Remove static-secret JWT fallback in production | **DONE 2026-05-19** — PR #44, commit `17b2727` |
| 0G | Enforce OTP MFA in Keycloak realm + smtpServer | **IN FLIGHT** — PR #45 (rebased onto main; MERGEABLE) |
| 0H | Correct n8n header to `x-internal-service-key` (all 62 templates) | **DONE 2026-05-18** — PR #41, commit `0242d09` |
| 0I | CI green: typecheck + Prisma + tests + advisory lint + CodeQL + npm audit + k6 advisory | not started |
| 0J | Phase 0 closeout: KI register update, BugBot review, evidence pack | **DONE 2026-05-18** — PR #48, commit `a89a1eb` |
| 0K | Governance: branch protection mandate + LICENSE + CODEOWNERS placeholder + repo description | **DONE 2026-05-18** — PR #43, commit `1193786` |
| 0L | **Transactional outbox + worker (load-bearing)** | not started |
| 0M | Supply-chain: pin `:latest`, SBOM (CycloneDX), Trivy, Checkov | **DONE 2026-05-18** — PR #42, commit `7ff4624` |
| 0N | Dependabot alerts enforcement + BugBot/CodeRabbit wiring | not started |

D-series follow-on (parked at the dataset chapter, gated on Phase 0A1):

| Batch | Title | Status |
|---|---|---|
| D12 | Live dataset importer with schema-overlap classifier | **DONE 2026-05-19** — PR #49, commit `e31e09e`. 78 vitest passing; 11/298 dataset tables currently covered (the rest is the Phase 12 schema-convergence workload per KI-S5-202). |

## Evidence pack

Accumulated at `evidence/phase-0/`:

- `bootstrap-step-summary.md` — from the workflow run (operator copies from Actions UI).
- `import-manifest.json` — list of files imported with sizes and SHAs.
- `verification-protocol-output.md` — results of running gates 1–14 against the final batch 0N tree.
- `bugbot-review-summary.md` — BugBot's run on the closeout commit.
- `sbom-cyclonedx.json` — CycloneDX SBOM from batch 0M.
- `trivy-report.json` — container-scan output from batch 0M.
- `outbox-roundtrip.md` — evidence that a test outbox event is written → picked up → delivered → marked DELIVERED.
- `mfa-screenshot.png` — Keycloak admin console showing OTP enforced on staff/admin roles.

## Operator-actions list

- [ ] Merge `chore/auto-merge-policy` (PR #3).
- [ ] Merge `chore/phase-0-bootstrap-workflow` (this PR — PR #4).
- [ ] Run the **Phase 0A — Bootstrap SJMS-2.5 spine** workflow with input `CONFIRM`.
- [ ] Phase 0K — set repository branch-protection rules per [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) §14.
- [ ] Phase 0K — set GitHub repo description (replace placeholder).
- [ ] Phase 0N — enable Dependabot alerts in Settings → Code security and analysis.
- [ ] Phase 0N — install BugBot or CodeRabbit (commercial choice; or accept code-reviewer subagent fallback).
- [ ] Phase 0 closeout — review and merge the Phase 0 PR after BugBot returns no HIGH.
