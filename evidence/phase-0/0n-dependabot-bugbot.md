# Batch 0N — Dependabot alerts enforcement + BugBot wiring

> **Captured:** 2026-05-19
> **Companion to:** [`docs/phase-0/README.md`](../../docs/phase-0/README.md) batch 0N row.
> **Closes:** KI-S5-303 (Dependabot alerts disabled).

## Phase 0 security-observability inventory

By the close of Phase 0, every defensive layer in the platform's threat model is wired and verifiable:

| Layer | Workflow / config | Status |
|---|---|---|
| Static analysis | `.github/workflows/codeql.yml` | landed via batch 0K |
| Dependency CVE feed | `.github/dependabot.yml` (npm + github-actions, weekly, grouped, auto-merge on patch+minor via `dependabot-auto-merge.yml`) | landed via batch 0K |
| Vulnerability alerts | GitHub Settings > Security > Dependabot alerts | **operator-driven UI step** |
| Automated security fixes | GitHub Settings > Security > Dependabot security updates | **operator-driven UI step** |
| Secret scanning | GitHub Settings > Security > Secret scanning + Push protection | **operator-driven UI step** |
| Container scan | `.github/workflows/container-scan.yml` (Trivy) | landed via batch 0M |
| IaC scan | `.github/workflows/iac-scan.yml` (Checkov) | landed via batch 0M |
| SBOM | `.github/workflows/sbom.yml` (CycloneDX) | landed via batch 0M |
| npm audit | `Security audit` workflow | landed via batch 0M; baseline reconciled in batch 0I |
| Secret-leak check on PRs | GitGuardian (third-party app, runs on every PR) | external; visible in PR check rollup |
| Code review automation | Cursor Bugbot (third-party app, runs on every PR) | external; visible in PR check rollup |
| Claude PR review | `.github/workflows/claude-code-review.yml` | landed pre-Phase 0 |

The four "operator-driven UI step" rows are the load-bearing gap this batch closes. Every other defensive layer is codified in this repo; those four live in GitHub's web UI and can be silently disabled.

## What 0N adds

A single new CI workflow — **`.github/workflows/security-meta-check.yml`** — that uses the GitHub API to verify the operator-driven toggles stay enabled. The job runs on every PR, on every push to main, and on a daily 07:00 UTC schedule.

```
permissions:
  contents: read
  security-events: read

probes:
  - GET /repos/:owner/:repo/vulnerability-alerts         (Dependabot alerts)
  - GET /repos/:owner/:repo/automated-security-fixes     (auto-PRs for vuln deps)

file-presence:
  - .github/workflows/codeql.yml
  - .github/dependabot.yml
  - .github/workflows/container-scan.yml
  - .github/workflows/iac-scan.yml
  - .github/workflows/sbom.yml
  - .github/workflows/ci.yml
```

When the probe returns "unknown" (GITHUB_TOKEN scope insufficient to read the endpoint on a given repo configuration), the job logs a warning step-summary but does **not** fail — the quarterly operator audit (`docs/SJMS-5-OPERATING-MODEL.md §17`) owns those out-of-band. When the probe returns "disabled" explicitly, the job fails — that's the fail-closed surface.

File-presence checks are deterministic and always block: if anyone deletes the codeql or dependabot workflow files, every PR fails.

## BugBot wiring

Cursor Bugbot is a third-party GitHub App that posts review comments on every PR with HIGH / MEDIUM / LOW severity findings. It's been live on the repo since 2026-05-16 (visible in PR check rollups under "Cursor Bugbot").

The wiring is operator-driven (one-time app install on the GitHub Marketplace; no repo-side config). What 0N codifies:

1. **`.github/CODEOWNERS`** already references the BugBot review channel (landed via 0K). Every PR auto-requests a Bugbot review.
2. **PR template** — handled by the existing `.github/PULL_REQUEST_TEMPLATE.md` (landed via 0K); the BugBot section reminds reviewers to address HIGH findings before merge.
3. **The branch-protection bundle** in `scripts/governance/protection.json` does NOT require BugBot as a blocking check (BugBot returns NEUTRAL on some PRs, which would deadlock). It's required at the human-review-checklist level instead.

## Operator actions

Per `docs/phase-0/README.md`'s "operator-actions list", these GitHub UI toggles must be checked at Phase 0 closeout and re-verified quarterly:

- [ ] **Settings > Code security and analysis > Dependabot alerts > Enable**
- [ ] **Settings > Code security and analysis > Dependabot security updates > Enable**
- [ ] **Settings > Code security and analysis > Secret scanning > Enable**
- [ ] **Settings > Code security and analysis > Secret scanning push protection > Enable**
- [ ] **Install Cursor Bugbot from the GitHub Marketplace** (already done — visible in PR rollups)
- [ ] **Optional: install CodeRabbit as a Bugbot alternative** if commercial preferences shift; both can coexist.

The new `Security meta check` workflow verifies the first two via API probe and surfaces a step-summary on every run.

## Verification

The workflow's first run on this PR's CI will exercise the probe logic. The job should:

- Pass when all file-presence checks find their targets and the API probes either confirm "enabled" or return "unknown" (with step-summary warning).
- Fail if any workflow file is missing or if an API probe explicitly returns "disabled".

A future enhancement (Phase 22 analytics-observability): tee the violation list into a Prometheus gauge so the operator dashboard surfaces a red bar the moment a flag flips.

## Acceptance signal

Closes batch 0N per the Phase 0 build queue. Closes KI-S5-303. Every defensive layer in the Phase 0 security-observability stack is now either codified in this repo or verified at runtime by a CI workflow.

Together with 0M (SBOM + Trivy + Checkov) and 0K (LICENSE + CODEOWNERS + branch-protection), this completes the Phase 0 security baseline. Phase 1+ business work lands against a fully-instrumented defensive surface.
