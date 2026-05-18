# Phase 0 — Readiness Audit

> **Captured**: 2026-05-18.
> **Companion to**: [`README.md`](./README.md) (the spec) — this doc is the **decision aid for pressing the button**, not a duplicate spec.

## TL;DR

Phase 0 is **approved, scaffolded, and has never been executed**. The bootstrap workflow merged in PR #4 but its `workflow_dispatch` trigger has not been invoked. No `phase-0/*` branch exists on origin (`git ls-remote origin 'refs/heads/phase-0*'` returns empty). The 976-file SJMS-2.5 spine is not in this repo.

Total Phase 0 effort to closure across all 14 batches (0A1 → 0N): **~66–94 hours**, or ~8–12 weeks at a 10-hour-per-week cadence. Of those, only **batch 0A1 (bootstrap) is a one-shot operator action** taking ~2 minutes; the rest are Claude-driven sequential PRs.

## What changed since [`README.md`](./README.md) was written

The README's operator-actions checklist is partly stale. Current state:

| Action | README assumption | Reality (2026-05-18) |
|---|---|---|
| Merge `chore/auto-merge-policy` (PR #3) | open | **MERGED** 2026-05-16 |
| Merge `chore/phase-0-bootstrap-workflow` (PR #4) | open | **MERGED** 2026-05-16 |
| Run Phase 0A workflow with `CONFIRM` | pending | **STILL PENDING** — workflow has not been triggered |
| Set branch-protection rules | pending | **STILL PENDING** — `gh api repos/RJK134/SJMS-5/branches/main/protection` returns 404 |
| Enable Dependabot alerts | pending | **STILL PENDING** — `gh api .../dependabot/alerts` returns 403 "Dependabot alerts are disabled" |
| Install BugBot / CodeRabbit | pending | **PARTIAL** — Cursor Bugbot runs on PRs (sometimes returns NEUTRAL conclusion) |

In addition, since the README was written, **the entire dataset chapter shipped** (D0–D11, then the operational layer: CI, audit-anchor, scheduled refresh, drift detector). That work is parked at the lake on `gdrive5tb:sjms-5-dataset/` and at the public anchor gist `858fb64fcf6505b2fc154f8ef9684973`. None of it required Phase 0 to land.

## What Phase 0 actually unblocks for the dataset

| Dataset deliverable | Currently blocked by | Phase 0 batch that unblocks it |
|---|---|---|
| **D12** — live Prisma upsert in `scripts/import-sjms-dataset.mjs` | No `@sjms-5/db` Prisma client; no SJMS-5 Prisma schema | **0A1** (bootstrap brings SJMS-2.5's `prisma/schema.prisma`) |
| **D13** — BullMQ scheduler for periodic dataset refresh | Same; plus no BullMQ wiring | **0A1** for schema, **0D** for BullMQ runtime |
| **KI-S5-205** — ~22 SJMS-2.5 ledger entities (StudentAccount, ChargeLine, …) added to generator | Need SJMS-2.5 schema visible to compare against v4-integrated dataset target | **0A1** (schema clone) + **0B** (18B/18C finance import) |

Note: **the dataset doesn't need Phase 0 to be _complete_ — it needs Phase 0A1 specifically**. After 0A1 + 0A2 the SJMS-2.5 Prisma schema lives in the SJMS-5 repo. D12 can wire against that schema even before 0B–0N land. The trade-off: Phase 0L (outbox) is explicitly load-bearing — domain work that lands before 0L will need refactoring once outbox events become mandatory. If D12's live importer emits domain events, it would be a refactor candidate.

### Schema convergence is its own thing

The dataset was generated against `RJK134/sjms-v4-integrated/prisma/schema.prisma` (298 models). Phase 0A1 brings in `RJK134/SJMS-2.5/prisma/schema.prisma` — a different shape (single-tenant, fewer models, Express-5-era). The importer scaffold's TODOs (e.g. `await tx[modelName].upsert(...)`) assume a model name from the dataset target survives in the imported schema. **It mostly will** for the common entities, but the convergence work — reconciling v4-integrated's expanded model surface with SJMS-2.5's spine — is itself a Phase 12 concern per `SJMS-5-SYNTHESIS-PLAN.md §7` (rehearsal + canonical import script with reconciliation; KI-S5-202).

The realistic D12 entry condition is: **the imported SJMS-2.5 schema covers enough of the dataset's 298 models to make the importer useful**. Anything not covered, the importer logs and skips; the dataset that doesn't import yet stays on the lake until the schema catches up.

## Critical-path options

Three sensible cuts at "what's next":

### Path A — Bootstrap only (minimum to unblock dataset D12)

1. Operator runs Phase 0A1 workflow (~2 min).
2. Claude rebases the importer scaffold (`scripts/import-sjms-dataset.mjs`) against the imported schema, wires actual `prisma.$transaction` upserts for the models that exist.
3. Land D12 as a PR.

**Cost**: ~4–6 hours of Claude work after bootstrap.
**Risk**: Skips 0A2 rebrand, 0B finance import, **and 0L outbox**. Future Phase 1+ work will refactor D12 to emit through outbox events. Acceptable if you accept the refactor.

### Path B — Outbox-first (Phase 0L + dependencies, then D12)

Phase 0 batches sequence as designed: 0A1 → 0A2 → 0B → 0C → 0D → 0E → 0F → 0G → 0H → 0I → 0J → 0K → **0L** → 0M → 0N → land. Then D12.

**Cost**: ~66–94 hours.
**Risk**: Long path to "D12 works". But every downstream phase (1+) is on a hardened, outbox-instrumented baseline. No refactor debt.

### Path C — Stay parked

The dataset is at a clean stopping point. Lake live, anchored, monitored. No reason to start Phase 0 today unless the strategic priority demands a working SJMS-5 backend soon.

**Cost**: zero.
**Risk**: Plan accumulates staleness if it sits too long (the synthesis plan + skills-lead briefs assume operator-paced delivery; gaps of months are fine, gaps of quarters start to bite).

## Decision points the operator must own (before pressing Phase 0A1)

These are not Claude-decidable:

1. **Outbox worker hosting**. 0D wires BullMQ; 0L assumes a long-running worker process. Vercel won't host it. Pick one: Railway, Render, Fly, or a local always-on machine. Includes provisioning a Redis instance (Upstash free-tier is fine for early phases).
2. **Code-review automation**. BugBot or CodeRabbit, or accept the `code-reviewer` subagent fallback. Cost differs. Phase 0N depends on this being chosen.
3. **Branch-protection policy**. SJMS-5-OPERATING-MODEL §14 mandates 2 reviewers + signed commits. With a solo operator that means every PR needs an explicit override or the policy is unrealistic. Decide: (a) keep policy, override on every solo PR; (b) loosen to 1 reviewer; (c) keep policy unenforced until the team grows.
4. **Schema convergence strategy** (relevant only if D12 is the goal). Two choices: (a) D12 targets SJMS-2.5's schema as imported by 0A1 — pragmatic, partial coverage of the 298-model dataset; (b) wait for Phase 12 convergence work — full coverage but very long path. (a) is recommended; iterate.

## Risks parked from the deep review

These are the items the synthesis plan + amendments flagged for Phase 0 closure. None are blocking 0A1 start, all need attention before 0J closeout signs Phase 0 off.

| KI | Title | Phase that closes it |
|---|---|---|
| KI-S5-201 | BullMQ workers cannot run on Vercel | 0D (Railway/Render/Fly host) |
| KI-S5-202 | Schema convergence could lose production data | 12 (rehearsal) |
| KI-S5-301 | No transactional outbox | **0L (load-bearing)** |
| KI-S5-302 | Bus-factor 1 | 0K (LICENSE, CODEOWNERS) |
| KI-S5-303 | Dependabot alerts disabled | 0N (confirmed still open per `gh api`) |
| KI-S5-304 | Plaintext secrets in JSON | 0C (cryptobox) |
| KI-S5-305 | `:latest` tags on MinIO/n8n containers | 0M (SBOM + pin) |

## Per-batch effort breakdown

Hours of Claude work per batch (after operator-triggered 0A1):

| Batch | Hours | Output | Notes |
|---|---:|---|---|
| 0A1 | ~0 (operator) | 976 files / 47 MB imported | One-shot workflow |
| 0A2 | 2–3 | package.json/README/CLAUDE.md rebrand | Surgical diff |
| 0B | 4–6 | 18B + 18C finance sub-commits | ~504 tests |
| 0C | 8–12 | cryptobox + AES-256-GCM + MinIO 4-bucket | Includes backfill script |
| 0D | 4–6 | BullMQ + Redis wiring | Worker scaffolded only |
| 0E | 2–3 | k6 nightly CI job | |
| 0F | 2–3 | Remove static JWT fallback | Audit + verify |
| 0G | 2–3 | Keycloak MFA + smtpServer | |
| 0H | 3–4 | n8n header fix (62 templates) | |
| 0I | 4–6 | CI baseline (tsc, Prisma, vitest, CodeQL, audit, k6) | |
| 0J | 2–3 | KI register + BugBot pass + evidence pack | |
| 0K | 3–4 | LICENSE + CODEOWNERS + branch protection | Operator clicks in GitHub UI |
| **0L** | **12–16** | **OutboxEvent model + migration + worker + admin endpoints + metrics** | **Load-bearing** |
| 0M | 6–8 | SBOM (CycloneDX) + Trivy + Checkov + pin tags | May surface HIGH/CRITICAL |
| 0N | 4–6 | Dependabot enable + security-meta-check CI + BugBot wire | |
| **Total** | **66–94** | | |

## Recommended next action

If the goal is forward momentum without a quarter-long commitment:

**Run Phase 0A1 workstation today**, then Claude does 0A2 (rebrand) the same session, then **stop and re-decide**. After 0A2 you have:
- A real SJMS-5 codebase (not just planning docs).
- A Prisma schema D12 can wire against.
- ~4 hours invested.

From there the decision becomes: continue down 0B → 0N, or jump to D12, or step away.

This minimises the cost of starting Phase 0 while maximising the optionality afterward. **It does not commit you to 0B–0N**.

## What to read before pressing the button

In priority order:

1. [`docs/phase-0/README.md`](./README.md) §"How to bootstrap" — the actual click-by-click.
2. [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) §14 — branch-protection mandate and Phase-0N activation gate.
3. [`docs/skills-leads/01-phase-0-spine-import.md`](../skills-leads/01-phase-0-spine-import.md) — the full Phase 0 domain brief Claude follows post-bootstrap.
4. [`.github/workflows/phase-0a-bootstrap-spine.yml`](../../.github/workflows/phase-0a-bootstrap-spine.yml) — header comment lists every batch 0A through 0N and what each contains.

## What to read if you're not pressing the button today

[`docs/SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md) — to check the staleness budget on the plan as documented vs reality.
