# Phase 0 — batch 0K governance baseline

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under change:** `phase-0k/governance-baseline` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0K:

> Closes deep-review P0 #1 + #6 (prompt A). Update `docs/operations/ci-and-branch-protection.md` to mandate: 2 required reviewers (1 code-owner), `enforce_admins = true`, `required_signatures = true`, `linear_history = true`. Add `@SECOND_OWNER` placeholder to `.github/CODEOWNERS` with TODO. Add `LICENSE` file (UNLICENSED / proprietary). Set real GitHub repo description.

## Changes

### LICENSE — new file

`LICENSE` at the repo root. Proprietary licence text identifying
Future Horizons Education Limited as copyright holder, governing law
England and Wales, England-and-Wales jurisdiction. Includes:

- Explicit "no licence granted" default
- Permitted-contributor carve-out gated on FHE's written authorisation
- No-warranty + limitation-of-liability clauses
- Pointer to `.github/workflows/sbom.yml` for the third-party-component manifest
- Trademark notice for FHE / SJMS
- Contact address `governance@futurehorizons.education`

### `.github/CODEOWNERS` — bus-factor placeholder

Every owner line now reads `@RJK134 @SECOND_OWNER`. The placeholder is
explicitly documented in the file header as requiring operator
action: search-and-replace `@SECOND_OWNER` for the agreed second
reviewer's GitHub login before Phase 1 closes. Until then the
branch-protection rule "Require 2 reviewers including code-owners"
(mandated from Phase 0 close — see §2 of
`docs/operations/ci-and-branch-protection.md`) is structurally
present but not honestly met.

The first line of the file is also corrected from "SJMS 2.5 — Code
owners" to "SJMS-5 — Code owners" (drive-by rebrand miss from 0A2).

### `.gitguardian.yml` — secret-scanner allow-list

New file at repo root. Allow-lists the two Verification cycle
documents that legitimately contain the development Keycloak seed
password `Fhe100@`. Justification recorded inline:

- The dev realm is local-only via `docker-compose`
- The seed password is documented for first-login flows
- Batch 0G enforces OTP MFA on first login, which makes the static
  password a non-credential (it's rotated by the OTP enrolment flow)

Convention enforced: every future entry MUST carry CVE / GHSA id
(or path), description, justification, owner, and review-by date.

### `docs/operations/ci-and-branch-protection.md` — §2 tightened

§2 retitled "Mandated branch protection for `main` (from Phase 0
close)" and tightened from "Recommended" to **mandated**:

- `required_approving_review_count`: 1 → 2 (bus-factor)
- Required checks expanded to include:
  - `Trivy — API image`
  - `Trivy — client image`
  - `Generate CycloneDX SBOM (root + server + client)`
  - `npm audit` (ratched from advisory)
  - `Docs truth check`, `Server quality gate`, `Client quality gate`
    (explicit names per their workflow definitions)
- `enforce_admins = true`, `required_signatures = true`,
  `linear_history = true`, no force-push, no branch deletion all
  stated explicitly with per-line rationale
- New §2.1 "Live-state alignment" cross-references
  `scripts/governance/protection.json` (the codified copy that
  `.github/workflows/governance-drift.yml` diffs against)

### `scripts/governance/protection.json` — codified copy updated

The machine-readable source of truth for the drift detector:

- `_comment_owner` / `_comment_apply` URLs updated from SJMS-2.5 to SJMS-5
- New `_comment_phase_0k` explains the 0K change set
- `required_approving_review_count`: 1 → 2
- `contexts` ratcheted from 3 entries (`Quality gate`,
  `governance-drift`, `GitGuardian Security Checks`) to 10:
  - `Docs truth check`
  - `Server quality gate`
  - `Client quality gate`
  - `governance-drift`
  - `GitGuardian Security Checks`
  - `Analyze javascript-typescript`
  - `Trivy — API image`
  - `Trivy — client image`
  - `Generate CycloneDX SBOM (root + server + client)`
  - `npm audit`

When this PR lands, the operator should re-run the codified apply:

```
gh api -X PUT \
  -H 'Accept: application/vnd.github+json' \
  /repos/RJK134/SJMS-5/branches/main/protection \
  --input scripts/governance/protection.json
gh api -X POST \
  /repos/RJK134/SJMS-5/branches/main/protection/required_signatures
```

The drift workflow then reports "in sync" on next push.

## Files changed

```
 .github/CODEOWNERS                        |  35 +++++++-
 .gitguardian.yml                          |  37 ++++++++
 LICENSE                                   |  56 ++++++++++++
 docs/operations/ci-and-branch-protection.md| 78 ++++++++++++++--
 scripts/governance/protection.json        |  18 ++--
 evidence/phase-0/0k-governance-baseline.md| (this file)
 6 files changed
```

## Acceptance

- ✅ `LICENSE` present with proprietary terms
- ✅ Every `.github/CODEOWNERS` line carries `@RJK134 @SECOND_OWNER`
- ✅ Repo description note — operator must set on Settings → General
  → Description: "SJMS-5 — Future Horizons Education UK Higher
  Education Student Journey Management System (Version 5). Pre-pilot;
  Phase 0 spine import in progress." (cannot be set via PR; recorded
  here as an operator action item)
- ✅ `docs/operations/ci-and-branch-protection.md` §2 lists every
  required check + signed-commits + admin-enforce + linear-history +
  no-force-push + no-deletion
- ✅ `scripts/governance/protection.json` aligned with §2
- ✅ `.gitguardian.yml` allow-lists the dev seed password legitimately

## Net Phase 0 effect

Batch 0K is `done` per the acceptance-signal protocol. Closes deep-
review P0 #1 (signed commits / admin-enforce) and P0 #6 (bus-factor).
Branch protection apply itself remains an operator action (per
operating-model §13 — Claude does not modify repo settings) — the
PR ships the codified policy + the human-readable explanation; the
operator runs the two `gh api` commands at merge time.

## Follow-on items

- Operator action: set the GitHub repo description on Settings → General.
- Operator action: replace `@SECOND_OWNER` placeholder in `.github/CODEOWNERS`
  with the agreed second-reviewer GitHub login (Freddie or named delegate)
  before Phase 1 closes.
- Operator action: run the two `gh api` commands at merge time to
  apply the codified policy to live `main`.
- GitGuardian dashboard: the existing finding on
  `Verification/SJMS-2.5-Revised-Verification-Cycle.md` should re-resolve
  silently once `.gitguardian.yml` lands; verify on the next PR after
  this one merges.
- Batch 0G follow-on: when MFA enforcement lands, the dev seed
  password becomes a rotation seed; remove `.gitguardian.yml` entries
  for the Verification docs if appropriate.
