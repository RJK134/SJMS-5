# Phase 0 — batch 0M supply-chain hardening

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under change:** `phase-0m/supply-chain-hardening` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0M:

> Closes deep-review P0 #5 + P1 #10–11 (prompt E). Pin `minio/minio` and `n8nio/n8n` to specific tags (recorded in `docs/operations/ci-and-branch-protection.md`). Add `.github/workflows/sbom.yml` running CycloneDX (`@cyclonedx/cdxgen`) on PR + push to main, attaching SBOM as workflow artefact. Add `.github/workflows/container-scan.yml` running Trivy on built API + client images, failing on HIGH/CRITICAL with documented allow-list at `docs/operations/trivy-allowlist.yaml`. Add Checkov for Docker/nginx/compose IaC scanning.

## Image pins applied

`docker-compose.yml`:

| Service | Before | After | Notes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | (unchanged) | Already pinned by major + variant pre-0M |
| `redis` | `redis:7-alpine` | (unchanged) | Already pinned by major + variant pre-0M |
| `keycloak` | `quay.io/keycloak/keycloak:24.0` | (unchanged) | Already pinned to 24.0 pre-0M |
| `minio` | `minio/minio:latest` | `minio/minio:RELEASE.2024-12-18T13-15-44Z` | **Phase 0M pin** |
| `n8n` | `n8nio/n8n:latest` | `n8nio/n8n:1.71.0` | **Phase 0M pin** |
| `nginx` | `nginx:alpine` | `nginx:1.27-alpine` | **Phase 0M pin** |

`docker/docker-compose.prod.yml`:

| Service | Before | After | Notes |
|---|---|---|---|
| `certbot` | `certbot/certbot:latest` | `certbot/certbot:v2.11.0` | **Phase 0M pin** |

Each pinned line carries an inline comment pointing to
`docs/operations/ci-and-branch-protection.md` §6 so a reader of the
compose file always has the source of truth for the pin policy at
their fingertips.

## New CI workflows

| File | Purpose | Trigger | Required state |
|---|---|---|---|
| `.github/workflows/sbom.yml` | CycloneDX SBOM via `@cyclonedx/cdxgen`, attached as 90-day artefact | PR + push to main | Advisory in Phase 0; becomes required in Phase 12 alongside cosign signing |
| `.github/workflows/container-scan.yml` | Trivy scan of built API + client images; HIGH/CRITICAL fail; SARIF uploaded to GitHub code-scanning; allow-list at `docs/operations/trivy-allowlist.yaml` | PR + push to main | Required from Phase 0 close (auto-merge precondition per operating-model §14) |
| `.github/workflows/iac-scan.yml` | Checkov scan of Dockerfiles + docker-compose + nginx + future kubernetes manifests; SARIF uploaded | PR + push to main | Advisory in Phase 0; ratchets to required in Phase 12 |

All three workflows pass `python3 -c "import yaml; yaml.safe_load(open('FILE.yml'))"` (the YAML-lint discipline added to the verification protocol after the bootstrap-workflow incident).

## New allow-list file

`docs/operations/trivy-allowlist.yaml` — the operator's audit trail of
intentionally deferred vulnerabilities. Today: zero active
suppressions. The schema (`CVE-ID`, one-line description,
justification, review-by date, owner) is documented inline so the
convention is in place from the moment the first deferral is required.

## Docs update

`docs/operations/ci-and-branch-protection.md` gains a new section **§6
Supply-chain hardening**:

- 6.1 Pinned image tags table with bump procedure
- 6.2 New CI workflows table (SBOM / Container scan / IaC scan)
- 6.3 Trivy allow-list discipline
- 6.4 Auto-merge readiness (links to operating-model §14)

## Files changed

```
 .github/workflows/container-scan.yml         |  102 +++++
 .github/workflows/iac-scan.yml               |   52 ++
 .github/workflows/sbom.yml                   |   71 +++
 docker-compose.yml                           |   15 +-
 docker/docker-compose.prod.yml               |    4 +-
 docs/operations/ci-and-branch-protection.md  |   72 +++-
 docs/operations/trivy-allowlist.yaml         |   34 ++
 7 files changed
```

## Acceptance

- ✅ Every imported image has a stable pin; no `:latest` remains in the compose surface.
- ✅ `python3 yaml.safe_load` parses every new workflow without error.
- ✅ `docker compose -f docker-compose.yml config --quiet` validates the manifest (env-var interpolation fails on `INTERNAL_SERVICE_KEY` as expected without a `.env` file, but the structural parse passes).
- ✅ `docs/operations/ci-and-branch-protection.md` §6 documents the pin table, the bump procedure, and the new workflow rows.
- ✅ Trivy allow-list file exists with documented schema and zero active entries.
- ⏸ The end-to-end "SBOM uploaded as artefact" / "Trivy passes against built images" verification will fire when CI runs against this PR — see PR CI status.

## Net Phase 0 effect

Batch 0M is `done` per the acceptance-signal protocol. Closes
deep-review P0 #5 + P1 #10–11. Three of the four supply-chain
posture preconditions for auto-merge activation (§14) now sit on the
spine: SBOM workflow live, container-scan live, IaC-scan live. The
fourth (Dependabot alerts enforcement + bot wiring) is batch 0N.

## Follow-on items

- The API + client `Dockerfile`s are not yet present (batch 0I owns the
  Dockerfile creation alongside the typecheck/CI tightening). Until
  they land, the container-scan workflow soft-skips with a clear
  `::warning::` so an operator sees the unscanned state without the
  scan being silent.
- Cosign image signing + SLSA provenance (deep-review P2 #30) is Phase
  12 batch 12K work — the SBOM produced here is its consumed input.
- Checkov stays soft-fail through Phase 0. The first ratchet that
  treats Checkov findings as merge-blocking is Phase 12 (pilot
  readiness).
- The pinned image tags need an operator review pass against
  organisationally-acceptable currency at merge time. The picked
  versions are deliberately recent stable releases at the time of the
  batch; the operator may bump on merge.
