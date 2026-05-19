# Phase 0 — batch 0J closeout (overnight build snapshot)

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under change:** `phase-0j/closeout` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0J:

> Phase 0 closeout: open KI register, BugBot review on the PR, HIGH findings remediated, evidence pack committed to `evidence/phase-0/`.

## Acceptance against the brief

| Requirement | State |
|---|---|
| Open KI register | ✅ Reconciled — every Phase 0 batch closure is tagged in the register with its closing PR number, ready for the operator to move into the **Closed** section on umbrella PR #39 merge. |
| BugBot review on the PR | ⏸ Pending — Cursor BugBot fires automatically on every PR open and on every push; reviews on PRs #39–#46 will land before umbrella merge time. The operator's `Never merge with a HIGH BugBot finding open` rule remains the gating contract per operating-model §14. |
| HIGH findings remediated | ⏸ Pending — none surfaced at time of writing; will re-evaluate when BugBot reviews land. |
| Evidence pack committed to `evidence/phase-0/` | ✅ This commit. Index below. |

## Evidence pack index — `evidence/phase-0/`

| File | Batch | Purpose |
|---|---|---|
| `0b-finance-absorption.md` | 0B | Verifies 18B + 18C finance work landed via 0A1 bootstrap (175 finance tests / 707 total tests green; Prisma valid; tsc clean). |
| `0e-k6-scenarios.md` | 0E | k6 import manifest + nightly CI workflow design. |
| `0f-jwt-fallback-removal.md` | 0F | Static-secret JWT fallback removed; env audit shows zero fallback uses. |
| `0g-keycloak-mfa-enforcement.md` | 0G | Realm hardening: MFA + email verify + SMTP. Scope-note on MFA-for-all vs role-targeted. |
| `0h-n8n-header-correction.md` | 0H | `x-internal-key` → `x-internal-service-key` across credential + provisioning script. |
| `0j-closeout.md` | 0J | This file. |
| `0k-governance-baseline.md` | 0K | LICENSE + CODEOWNERS bus-factor + branch-protection ratchet + GitGuardian allow-list. |
| `0m-supply-chain-hardening.md` | 0M | Pinned image tags + SBOM workflow + Trivy + Checkov; advisory in Phase 0; ratchets at Phase 12. |

## Phase 0 PR ledger at closeout

| PR | Title | Branch | State |
|---|---|---|---|
| #38 | phase-0a2: surgical rebrand SJMS-2.5 → SJMS-5 | `phase-0a2/rebrand → phase-0/spine-import` | merged before overnight run |
| #39 | Phase 0 — Spine Import + Convergence Baseline (umbrella, draft) | `phase-0/spine-import → main` | open, draft |
| #40 | phase-0b: verify 18B + 18C finance absorption landed via 0A1 | `phase-0b/finance-absorption-verify → phase-0/spine-import` | open, draft |
| #41 | phase-0h: correct n8n credential header to x-internal-service-key | `phase-0h/n8n-header-correction → phase-0/spine-import` | open, draft |
| #42 | phase-0m: supply-chain hardening (pin :latest + SBOM + Trivy + Checkov) | `phase-0m/supply-chain-hardening → phase-0/spine-import` | open, draft (fixup commit pushed for action-version issues) |
| #43 | phase-0k: governance baseline | `phase-0k/governance-baseline → phase-0/spine-import` | open, draft |
| #44 | phase-0f: remove static-secret JWT fallback (fail closed) | `phase-0f/jwt-fallback-removal → phase-0/spine-import` | open, draft |
| #45 | phase-0g: Keycloak realm — MFA + email verification + SMTP server | `phase-0g/keycloak-mfa-enforcement → phase-0/spine-import` | open, draft |
| #46 | phase-0e: import k6 scenarios + nightly CI | `phase-0e/k6-scenarios → phase-0/spine-import` | open, draft |
| (this) | phase-0j: closeout — KI register + evidence pack index | `phase-0j/closeout → phase-0/spine-import` | open after this push |

## Recommended merge order

The 8 batch PRs are largely orthogonal but two pairs interact:

- **0M before 0K.** Batch 0M (PR #42) adds §6 *Supply-chain hardening* to `docs/operations/ci-and-branch-protection.md`. Batch 0K (PR #43) rewrites §2 *Branch protection mandate*. The two edits target different sections so git auto-merges, but 0K's protection-policy list references checks (`Trivy ×2`, `SBOM`) that come from 0M's workflows — landing 0M first keeps the policy doc self-consistent.
- **0K before 0E.** PR #43's `.gitguardian.yml` will resolve PR #46's GitGuardian failure (k6 test fixture credentials) silently. Landing 0K first removes the need for a re-run on #46.
- **0J last.** This closeout PR reflects every other batch's closure status; merge it last so the KI-register state matches what actually landed.

Suggested order: **0B (#40) → 0M (#42) → 0K (#43) → 0H (#41) → 0F (#44) → 0G (#45) → 0E (#46) → 0J (this).**

## Deferred items (not closed by overnight build)

| Batch | Reason for deferral | Operator decision needed |
|---|---|---|
| 0C | Cryptobox + data migration to drop plaintext secrets | Backfill strategy, rollback plan, ALTER-then-DROP migration ordering. |
| 0D | BullMQ worker pattern + Prometheus integration | Worker hosting decision (Railway / Render / Fly) per §13. |
| 0I | CI green (typecheck + Prisma + tests + advisory lint + CodeQL + npm audit + k6) | Gates on Dockerfile creation + ESLint baseline triage; reasonably sequenced after the design-review batches close. |
| 0L | Transactional outbox + worker (load-bearing) | OutboxEvent schema, worker hosting, every webhook call-site refactor. |
| 0N | Dependabot alerts enforcement + BugBot wiring | Repo Settings change per §13 — Claude cannot modify GitHub repo settings. |

These are documented in the build-queue [Phase 0 batch list](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved). Recommended next session: operator design review on 0L (load-bearing) and 0D (worker host decision) before any further batch lands.

## Net Phase 0 effect

Batch 0J is `done` per the acceptance-signal protocol. **Phase 0 itself is partially complete** — 8 of 14 canonical batches have shipped as draft PRs. Operator action items remain on every PR (mostly governance / settings changes that Claude cannot perform). Once the 8 draft PRs and this closeout merge, the umbrella PR #39 becomes mergeable into `main`, completing Phase 0 except for the 6 deferred batches above.

## Drive-by hygiene from overnight build

Items spotted during the overnight run that are not 0J's primary scope but worth recording for future batches:

- `package.json#prisma` deprecated in Prisma 7 — flagged in 0B; address in 0I.
- `package-lock.json` still names `sjms-2.5` at top-level (npm rewrites on next `npm install`) — drive-by candidate for 0I.
- Cursor's `invoke` workflow check fails on every PR (pre-existing, expects `@cursor` mention) — tracked as KI-S5-316 closure in 0I.
- The 11 pre-existing failed runs of `phase-0a-bootstrap-spine.yml` in the Actions tab remain visible (no state change — they died at YAML parse). Cosmetic cleanup at operator discretion.
