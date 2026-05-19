# Session handover — 2026-05-18 overnight build

> **Branch state at handover:** every overnight batch pushed; 9 draft PRs open against `phase-0/spine-import` (umbrella #39 + batches #40–#46, #48). No commits on `main` from this session. Operator action required to merge.

## Last commit on main

`dbf0183c7a80bf4d72572cc5bff0b2e37bd028fc` — `fix(phase-0a): use SJMS_V4_TOKEN for checkout (#37)` — pre-existing, untouched by this session.

## Last commit on `phase-0/spine-import`

`167d9adecb51b43b4531b6f0aeb7938399b4b173` — `phase-0a2: surgical rebrand SJMS-2.5 → SJMS-5 (#38)` — pre-existing, untouched.

## Open PRs from this session (all draft)

| PR | Branch | Batch | Target |
|---|---|---|---|
| #39 | `phase-0/spine-import` | Phase 0 umbrella | `main` |
| #40 | `phase-0b/finance-absorption-verify` | 0B | `phase-0/spine-import` |
| #41 | `phase-0h/n8n-header-correction` | 0H | `phase-0/spine-import` |
| #42 | `phase-0m/supply-chain-hardening` | 0M | `phase-0/spine-import` |
| #43 | `phase-0k/governance-baseline` | 0K | `phase-0/spine-import` |
| #44 | `phase-0f/jwt-fallback-removal` | 0F | `phase-0/spine-import` |
| #45 | `phase-0g/keycloak-mfa-enforcement` | 0G | `phase-0/spine-import` |
| #46 | `phase-0e/k6-scenarios` | 0E | `phase-0/spine-import` |
| #48 | `phase-0j/closeout` | 0J | `phase-0/spine-import` |

(PR #47 was not opened — number skipped, possibly an internal MCP increment.)

## Active branches (other than main)

- `claude/sjms-5-development-lUWM7` — empty (identical to an old main), created early in the session as the designated dev branch per the bootstrap prompt. Harmless. Can be deleted post-merge.
- `chore/add-handover-2026-05-17`, `chore/plan-amendments-and-skills-leads` — pre-existing, untouched.
- Eight `phase-0X/...` branches matching the PR table above.
- The dataset `phase-D*/...` branches — pre-existing parallel workstream, untouched.

## In-flight work not yet pushed

None. Every batch I started landed as a draft PR before this handover.

## Subscribed PR activity

I subscribed to PR activity on every PR I opened (#39, #40, #41, #42, #43, #44, #45, #46, #48). Notifications will arrive in any future session subscribed to the same set. To unsubscribe at session end, call `mcp__github__unsubscribe_pr_activity` for each.

## Operator decisions pending

Documented in detail on each batch's evidence file in `evidence/phase-0/`. Summary:

| PR | Operator action |
|---|---|
| #43 (0K) | Replace `@SECOND_OWNER` in `.github/CODEOWNERS` with a real GitHub login; set the GitHub repo description on Settings → General; apply the codified branch protection (two `gh api` calls per the PR body). |
| #45 (0G) | Set the SMTP password in Keycloak admin console; replace placeholder `smtp.example.com` host; extend `scripts/keycloak-setup.ts` to enrol TOTP + verify email on seeded test users. |
| #46 (0E) | Set `K6_BASE_URL` repo secret; configure a `sjms-5-load-test` confidential client in the Keycloak realm; set Keycloak load-test secrets. |
| #42 (0M) | Review the pinned image tags against current organisationally-acceptable versions; bump on merge if needed. |
| #48 (0J) | Post-merge sweep — move "pending closure via PR #N" KI rows into the Closed section with the umbrella merge SHA + date. |

## Pre-existing CI failures on umbrella #39

`Server quality gate`, `Client quality gate`, `Lint (advisory)`, `npm audit`, `Quality gate`, `GitGuardian Security Checks` — **all pre-existing on the imported SJMS-2.5 spine, not introduced by overnight batches**. Tracked for batch 0I (CI green) per the build queue. Local repro confirms server tests pass (`707 / 42`), `tsc --noEmit` clean, `prisma validate` green — the CI failures likely stem from runner env-var preconditions (`DATABASE_URL` / `DIRECT_URL`) that the local environment doesn't reproduce.

GitGuardian on umbrella #39 specifically: the `Verification/SJMS-2.5-Revised-Verification-Cycle.md` dev seed password `Fhe100@` — explicitly allow-listed by 0K's `.gitguardian.yml`. Resolves silently once 0K merges.

## STOP-gates triggered

None this session. Phase 0 itself is operator-approved per the synthesis plan §11. The remaining STOP-gated work (Phase 2 multi-tenancy, Phase 5 employer_admin Keycloak role, Phase 11 AI-native, Phase 12 SAML federation) is untouched.

## CI workflows I introduced that have known issues

PR #42 (0M):
- `Trivy — API image`, `Trivy — client image` — runtime fail; advisory (`continue-on-error: true`).
- `Generate CycloneDX SBOM (root + server + client)` — runtime fail; advisory.
- `Checkov — Docker + nginx + compose` — runtime fail; advisory.

I attempted a fixup (action versions `@master`, added `continue-on-error: true`, defensive cdxgen install path). The actions now resolve and run but fail during execution. Local cdxgen repro produced a valid 802-component SBOM, so the GitHub Actions context has something subtly different (most likely the Trivy needs Docker images that the workflow builds itself; if the build fails Trivy has nothing to scan). All four jobs are advisory in Phase 0 and ratchet to required in Phase 12. Operator can iterate as part of 0I.

PR #46 (0E):
- `k6-nightly.yml` is not exercised by PR builds — runs on schedule (`cron: '0 3 * * *'`) and `workflow_dispatch` only. No PR-level signal until staging is configured.

## Recommended next session opener

1. Read this handover.
2. Read `docs/SJMS-5-KNOWN-ISSUES.md` "Phase 0 progress" section (added by 0J).
3. Triage operator decisions on 0L (outbox topology) and 0D (worker host) before any further batch lands — those two are the load-bearing remainders.
4. If operator merge has happened, perform the KI register Closed-section sweep per the brief at the bottom of #48's evidence file.
5. Open the next phase only after Phase 0 umbrella PR #39 has landed and the deferred batches (0C, 0D, 0I, 0L, 0N) have shipped or been explicitly accepted as deferred.

## Anything to be ashamed of

- Spent some early-session cycles on a defensive workflow fix (PR #44 territory) before discovering the operator's other session had already shipped PR #37 / #38 to address the actual workflow blocker. Reading the latest commits on `main` is the right cheap check before assuming a session-prompt context is current. Adjusted on the fly; no harm done.
- The `replace_all` glob in my first CODEOWNERS edit clobbered the catch-all line (one of the `@RJK134` matches replaced into `@RJK134 @SECOND_OWNER @SECOND_OWNER`). Reset and re-did via a Python script — the right tool for a structured rewrite. Recorded here so future sessions reach for the right hammer first.
