# CI gates and branch protection

> **Audience:** Repository administrators (currently Richard).
> **Purpose:** Document the CI surface, the recommended GitHub branch
> protection configuration, and the rationale. Branch protection itself
> must be configured in the GitHub UI — this file is the source of truth
> for what to tick.
> **Last updated:** 2026-04-25

---

## 1. The CI surface today

| Workflow | Trigger | Mandatory? | What it does |
|---|---|---|---|
| `CI` (`.github/workflows/ci.yml`) | PR + push to main | Yes | Server typecheck + Prisma validate + Vitest with coverage; Client typecheck; advisory lint; **docs truth check** |
| `CodeQL` (`.github/workflows/codeql.yml`) | PR + push + weekly | Yes | Static analysis with `security-extended` query suite |
| `Security audit` (`.github/workflows/security-audit.yml`) | PR + push + daily | Advisory | `npm audit` against root, server, client; surfaces HIGH/CRITICAL counts |
| `GitGuardian Security Checks` | PR | Yes (3rd party) | Secret scanning across the diff |
| Cursor agent workflows | manual / dispatch | No | Cursor BugBot integration; not a merge gate |

The four jobs in `CI` are independent and run in parallel:

- `Docs truth check` — ~30 s, no install
- `Server quality gate` — ~6–10 min: install → prisma generate → prisma
  validate → tsc → vitest with coverage → publish summary
- `Client quality gate` — ~3–5 min: install → prisma generate → tsc
- `Lint (advisory)` — ~3–5 min: install → eslint server + client; currently
  `continue-on-error: true`

`concurrency: cancel-in-progress: true` is enabled at the workflow level, so
pushing a new commit to a PR cancels the in-flight run.

---

## 2. Recommended required checks for `main`

Set the following on the GitHub repo **Settings → Branches → Branch
protection rules → `main`**:

```
✓ Require a pull request before merging
  ✓ Require approvals (at least 1)
  ✓ Dismiss stale pull request approvals when new commits are pushed
  ✓ Require review from Code Owners

✓ Require status checks to pass before merging
  ✓ Require branches to be up to date before merging
    Required checks (exact case, exact spacing):
      ✓ Docs truth check
      ✓ Server quality gate
      ✓ Client quality gate
      ✓ GitGuardian Security Checks
      ✓ Analyze javascript-typescript          (CodeQL)

  Optional checks (visible in PR but not blocking):
      • Lint (advisory)
      • npm audit
      • dispatch                                (Cursor integration glue)

✓ Require conversation resolution before merging
✓ Require linear history
✓ Do not allow bypassing the above settings
```

The `Lint (advisory)` and `npm audit` jobs are deliberately advisory while
the ESLint baseline (`KI-P15-002`) and the npm audit baseline
(`KI-P15-001`) are being triaged. They will be ratcheted to required
status as those KIs close.

---

## 3. PR template alignment

The PR description template (`.github/pull_request_template.md`) lists the
acceptance gates each PR must clear. Keep that list aligned with section 2
above — when a check ratchets from advisory to required, also tick it in
the template.

---

## 4. Operational guidance

### Forcing a re-run after a flake
Push an empty commit, or use the GitHub Actions "Re-run failed jobs"
button. **Do not** override branch protection to merge a flaky PR — the
gates are required precisely so that flakes get diagnosed instead of
shipped around.

### Handling a baseline-CI red flag
If the `main` branch CI is red (as recorded under `F-008` and `F-009` in
`docs/review/overnight-truth-audit.md`), open a focused
`chore/<reason>-baseline` PR that only fixes the baseline. Do not bundle
the fix with content changes.

### Adding a new gate
1. Land the gate first as advisory (`continue-on-error: true`) so the
   baseline is observable without blocking.
2. Triage findings on a dedicated `fix/<gate>-baseline` branch.
3. Flip `continue-on-error: false`.
4. Tick the new gate as required in branch protection.
5. Update this file and `.github/pull_request_template.md`.

---

## 5. What is deliberately not a CI gate today

- **Playwright E2E** — currently invoked manually because the Docker stack
  is not part of the GitHub runner image. Noted in
  `docs/delivery-plan/enterprise-readiness-plan.md` as an integration step
  for a later phase.
- **Coverage thresholds** — owned by `server/vitest.config.ts`, currently
  0/0/0 (`KI-P14-002`); a ratchet is sequenced to Phase 17.
- **Container build** — neither `server/Dockerfile` nor `client/Dockerfile`
  is exercised by CI today; treat them as experimental (see README).

The honest framing is: these are *known omissions* with named owners and
scheduled ratchets — they are not silent gaps.

---

## 6. Supply-chain hardening (Phase 0 batch 0M)

Closes deep-review P0 #5 and P1 #10–11. Lifts SJMS-5 from "advisory
secret-scan and CodeQL" to a multi-layer supply-chain posture before
Phase 0 closes.

### 6.1 Pinned image tags

`docker-compose.yml` and `docker/docker-compose.prod.yml` no longer pull
floating `:latest` tags. Every image is pinned to a specific tag so the
container surface is reproducible across the local-dev, staging, and
production environments.

| Image | Pin | File |
|---|---|---|
| `postgres` | `16-alpine` | `docker-compose.yml` (was already pinned by major) |
| `redis` | `7-alpine` | `docker-compose.yml` (was already pinned by major) |
| `quay.io/keycloak/keycloak` | `24.0` | `docker-compose.yml` (was already pinned) |
| `minio/minio` | `RELEASE.2024-12-18T13-15-44Z` | `docker-compose.yml` (pinned in 0M) |
| `n8nio/n8n` | `1.71.0` | `docker-compose.yml` (pinned in 0M) |
| `nginx` | `1.27-alpine` | `docker-compose.yml` (pinned in 0M; previously `alpine`) |
| `certbot/certbot` | `v2.11.0` | `docker/docker-compose.prod.yml` (pinned in 0M) |

**Bump procedure.** When the operator wants to bump a pinned image:

1. Update the tag in the relevant `docker-compose*.yml` file.
2. Update the row in this table.
3. Run the `Container scan` workflow against the new tag. Address any
   HIGH / CRITICAL findings before merging.
4. Note the rationale in the PR body (security fix? feature need?
   deprecation?).
5. The post-merge `Container scan` run on `main` is the durable
   audit record of the bump.

### 6.2 New CI workflows

| Workflow | File | Trigger | Required? | What it does |
|---|---|---|---|---|
| `SBOM` | `.github/workflows/sbom.yml` | PR + push to main | Advisory in Phase 0; required in Phase 12 | CycloneDX SBOM (root + workspaces) attached as artefact (90 d retention). |
| `Container scan` | `.github/workflows/container-scan.yml` | PR + push to main | Required from Phase 0 close | Trivy against API + client images. Fails on HIGH/CRITICAL; allow-list at `docs/operations/trivy-allowlist.yaml`. SARIF uploaded to GitHub code-scanning. |
| `IaC scan (Checkov)` | `.github/workflows/iac-scan.yml` | PR + push to main | Advisory in Phase 0; required in Phase 12 | Checkov against Dockerfiles, docker-compose, nginx, future kubernetes manifests. SARIF uploaded to GitHub code-scanning. |

### 6.3 Trivy allow-list discipline

`docs/operations/trivy-allowlist.yaml` carries every intentional
HIGH/CRITICAL suppression. Each entry MUST record CVE/GHSA id,
one-line description, justification, review-by date (ISO 8601), and
owner. Today's posture: zero active suppressions — every finding must
be remediated, not suppressed. The file's structure exists so the
convention is in place from the moment the first genuine deferral is
required.

### 6.4 Auto-merge readiness

Per [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) §14,
auto-merge for Dependabot PRs activates after batch 0N closes. The
required-checks set then becomes: typecheck, prisma validate, vitest,
docs:check, CodeQL, npm audit, `Container scan`, `SBOM`, and
`security-meta-check`. `IaC scan` and the (Phase 12) cosign provenance
check sit alongside as advisory until their ratchet phase.
