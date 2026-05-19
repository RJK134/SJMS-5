# Session handover — 2026-05-19

> **Read first.** This is the single document a fresh Claude Code session should load before
> continuing the SJMS-5 build. It captures everything the previous session knew, the state of
> `main`, the open PRs, the operator actions pending, and the recommended next move.
>
> **Companion documents:**
> - [`docs/operations/operator-action-register.md`](../operations/operator-action-register.md) — consolidated operator-side actions outside Claude's reach
> - [`docs/SJMS-5-SYNTHESIS-PLAN.md`](../SJMS-5-SYNTHESIS-PLAN.md) — master 12-phase plan (unchanged since Phase 0)
> - [`docs/SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) — wins over the synthesis plan
> - [`docs/SJMS-5-BUILD-QUEUE.md`](../SJMS-5-BUILD-QUEUE.md) — per-phase batch ledger
> - [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) — non-negotiable delivery rules (§13 operator constraints, §14 auto-merge policy)
> - [`docs/SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md) — KI register (Phase 0 close section + items deferred to later phases)
> - [`docs/skills-leads/`](../skills-leads/) — 13 domain-lead briefs (one per phase)
> - [`docs/architecture/outbox-worker-hosting.md`](../architecture/outbox-worker-hosting.md) — Railway worker host design
> - [`evidence/phase-0/`](../../evidence/phase-0/) + [`evidence/phase-1/`](../../evidence/phase-1/) — per-batch evidence packs

---

## 1. Where we are

### 1.1 Phase status

| Phase | State |
|---|---|
| **Phase 0 — Spine import + convergence baseline** | ✅ **COMPLETE on `main`** as of 2026-05-19. All 14 canonical batches (0A1, 0A2, 0B, 0C, 0D, 0E, 0F, 0G, 0H, 0I, 0J, 0K, 0L, 0M, 0N) merged. See [`docs/SJMS-5-KNOWN-ISSUES.md`](../SJMS-5-KNOWN-ISSUES.md) "Phase 0 — COMPLETE" section for the merge-SHA ledger. |
| **Phase 1 — Finance closeout** | **In flight.** Batch 1A shipped as draft PR #81 (this session). Branches `phase-1h/optimistic-locking` + `chore/audit-fk-1i-20260519` are in flight by other agents (no PRs yet at time of writing). Batches 1B–1G + 1H + 1I remain. |
| Phase 2 — Multi-tenancy substrate | STOP-gated — needs design doc + operator sign-off. |
| Phase 3 — HESA / UKVI / regulatory | Not started. Carries known v4 runtime defect (KI-S5-101 HesaReturns throw) to fix. |
| Phases 4–10 | Not started. |
| Phase 11 — AI-native | STOP-gated — needs independent ethics review. |
| Phase 12 — Pilot readiness | STOP-gated — needs external pentest + SAML + DR + DPIA + cosign signing. |

### 1.2 What's verified on `main`

At commit `0e2761f` (Phase 0 final merge):

```
$ git checkout main && DATABASE_URL=postgresql://… npx prisma generate
$ cd server && npx tsc --noEmit
(exit 0)

$ cd server && npx vitest run
 Test Files  46 passed (46)
      Tests  740 passed (740)

$ npx prisma validate
Prisma schema valid 🚀
```

**Note for the next session:** the build script (`npm run build`) runs `prisma generate` before `tsc`. Bare `tsc --noEmit` on a fresh clone will fail with `Property 'outboxEvent' does not exist on type 'PrismaClient'` until you generate the client. This is normal — generated clients are not committed.

### 1.3 What shipped in the most recent session (2026-05-19)

| PR | State | Title | Branch |
|---|---|---|---|
| **#74** | open, draft | docs(architecture): outbox worker hosting design note (Railway, eu-west2) | `docs/outbox-worker-design-note` |
| **#75** | open, **non-draft** | docs: D0 schema audit — 197 models grouped by domain + convergence gap analysis | `docs/d0-schema-audit` |
| **#76** | open, **non-draft** | feat(server): bullmq weekly scheduler for sjms-dataset import (phase D8) | `feat/sjms-dataset-bullmq-scheduler` |
| **#77** | open, **non-draft** | chore(dataset): close top-10 shape gaps in importer (phase D0 follow-up) | `chore/sjms-dataset-shape-convergence-pass1` |
| **#78** | open, draft | chore(docs): reconcile Phase 0 status — flip to COMPLETE 2026-05-19 | `chore/post-phase-0-doc-reconcile` |
| **#81** | open, draft | **phase-1a: payment-instalment cron — auto-generate ChargeLines on dueDate** | `phase-1a/payment-instalment-cron` |

### 1.4 What's NOT yet on `main`

- **Phase 1A** (payment-instalment cron) — PR #81 draft
- **Phase 0 docs reconcile** — PR #78 draft (cosmetic; the actual Phase 0 close is on `main`)
- **Phase 1H, 1I** — branches exist (`phase-1h/optimistic-locking`, `chore/audit-fk-1i-20260519`), no PRs yet
- **Dataset workstream** — PRs #75, #76, #77 open; D-phase branches (`phase-D0/...` through `phase-D11/integration` and `phase-D12/...`) are the parallel dataset-build track

---

## 2. The pilot anchor — FHE University

**Pilot institution identified:** **FHE University**, a synthetic-mirror UK HE institution matching the shape of a Tribal SITS / Ellucian Banner deployment. Operator is building the comprehensive synthetic dataset on Google Drive at `richardknapp134@gmail.com` (`gdrive5tb:sjms-5-dataset/`).

**Bus-factor mitigation in progress:** Freddie to be added as second collaborator on the repo. `@SECOND_OWNER` placeholder in `.github/CODEOWNERS` should be replaced with Freddie's GitHub login before Phase 1 closes.

These two changes materially reduce the two highest risks I flagged in the 2026-05-18 review: missing pilot anchor and bus-factor 1.

---

## 3. The next phase

### 3.1 What's next

**Phase 1 — Finance closeout** is in flight. Remaining batches:

| Batch | Scope | Claim state |
|---|---|---|
| 1A | Payment plans cron generator | **PR #81 draft (Claude, this session)** |
| 1B | Sponsors + SponsorAgreement + SponsorInvoice (FINANCE-gated) | Unclaimed — natural next |
| 1C | Bursaries — `BursaryFund`, `BursaryApplication`, auto-decisions by fund rule | Unclaimed |
| 1D | Refund approvals (REGISTRY proposes → FINANCE approves) — closes KI-S5-001 | Unclaimed |
| 1E | Ledger anomaly detection job on BullMQ (negative balance, orphan ChargeLine, duplicate invoice number) | Unclaimed |
| 1F | Finance dashboards in staff portal — fixes v4 `/staff/finance-overview` 404 (KI-S5-102) | Unclaimed |
| 1G | Phase closeout — BugBot, coverage ratchet +3pp, evidence pack | Sequenced last |
| 1H | Optimistic locking — `version Int @default(1)` on `Mark`, `ModuleResult`, `Invoice`, `Payment`, `ExamBoardDecision`, `AssessmentAttempt`, `Enrolment` — closes KI-S5-312 | **In flight on `phase-1h/optimistic-locking` (other agent)** |
| 1I | `AuditLog.userId` promoted from free-text to FK on `User` (`onDelete: Restrict`) — closes KI-S5-313 | **In flight on `chore/audit-fk-1i-20260519` (other agent)** |

### 3.2 Recommended next move for the new Claude session

**Option A — Continue Phase 1 batches (recommended):**
1. Pick **1B (Sponsors)** as the next batch. Independent of 1A, no STOP-gate, ~1 hour.
2. Then 1C (Bursaries), 1D (Refunds) in sequence. Each ~1–2 hours.
3. 1E (anomaly detector on BullMQ) leverages the now-merged 0D scaffolding + 0L outbox.
4. 1F (staff finance dashboards) closes KI-S5-102.
5. 1G closeout once 1A–1F land.

**Option B — Help close the dataset workstream first:**
1. Review PRs #75, #76, #77 for merge.
2. Pull the dataset importer through D2 → D11 batches if not already done.
3. Then Phase 1.

**Option C — Operator triage focus:**
1. Triage and merge the 6 open PRs (#74, #75, #76, #77, #78, #81).
2. Then Phase 1.

**Recommendation:** Option A if the operator merges #81 first. The cron infrastructure introduced in 1A is reused by 1E (BullMQ anomaly detector), so the batches build on each other.

### 3.3 STOP-gates the new session must respect

- **Phase 2 (multi-tenancy)** — needs a design doc approved by the operator before any code touches `tenantId` rollout. Do not start.
- **Phase 5 (`employer_admin` Keycloak role)** — touches `roles.ts`; operating-model §6 lists `roles.ts` as STOP-gated.
- **Phase 11 (AI-native)** — needs independent ethics review.
- **Phase 12 (pilot readiness, SAML)** — needs external pentest engagement first.

---

## 4. Operating model — non-negotiables for the next session

Read [`docs/SJMS-5-OPERATING-MODEL.md`](../SJMS-5-OPERATING-MODEL.md) in full. The session-critical excerpts:

1. **One phase branch from `main` at a time.** Phase 1 work goes on `phase-1/finance-closeout`, OR each batch ships as its own sub-branch merging to `main` (the pattern PRs #67–#73 used). The PR #81 pattern (`phase-1a/payment-instalment-cron`) is consistent with the latter.
2. **3–8 reviewable batches per phase.** Phase 1 has 9 sub-batches (1A–1I); that's tight but acceptable.
3. **PR opens as DRAFT.** Operator merges manually per §14 (auto-merge is OFF until Phase 0N gates fire — which is to say, after operator settings work; the policy is shipped but not yet active in repo settings).
4. **Title describes business outcome, not action.** Avoid "add X" titles; prefer "automate Y" or "close Z gap".
5. **Squash merge per §4.** PR body becomes squash body.
6. **British English throughout.** `enrolment`, `programme`, `colour`, `centre`, `organisation`.
7. **Prisma-backed persistence only.** No MemStorage or in-memory business stores.
8. **Audit + outbox event on every mutation.** The outbox (PR #71) is on `main`; new code should write `OutboxEvent` rows via the established pattern.
9. **No direct Prisma in services.** Gate 4 of the verification protocol. Services route through repositories.
10. **Operator runs no local Docker / npm / prisma / terminal commands.** §13. Every change must build via Vercel auto-deploy from `main` and/or via the Railway worker host for long-running processes.

---

## 5. Workspace setup — what the new session inherits

The remote container the previous session ran in had:

- Node v22.22.2 / npm 10.9.7 / pnpm 10.33.0
- Three local clones at `/home/user/`: `SJMS-5`, `SJMS-2.5`, `sjms-v4-integrated`
- Docker available; `gh` CLI NOT available
- GitHub MCP scoped to `rjk134/sjms-2.5`, `rjk134/sjms-v4-integrated`, `rjk134/sjms-5` only
- No `ANTHROPIC_API_KEY` configured (the `claude.yml` workflow skips when no `@claude` mention)

The new session will get a fresh container. Re-clone the repo and run `npm install` + `prisma generate` before the first edit.

---

## 6. Critical gotchas the previous session burned cycles on

1. **`prisma generate` before `tsc`.** Bare `tsc --noEmit` fails on `outboxEvent`-style references until the client is generated.
2. **YAML-lint workflow files before push.** The Phase 0A bootstrap workflow burned 11 failed runs because nobody YAML-linted the `run: |` block contents. Always run `python3 -c "import yaml; yaml.safe_load(open('FILE.yml'))"` before pushing any `.github/workflows/*.yml` change.
3. **MCP `push_files` ~64 KB limit per call.** Large refactors that touch many files need either local commits + git push, or chunked `push_files` calls.
4. **Concurrent agents.** Multiple Claude sessions / Cursor agents may open PRs in parallel (e.g. PR #38 was opened by another agent while the bootstrap was running). Always `git fetch --all` and check `mcp__github__list_branches` + `list_pull_requests` before assuming the baseline matches a prior handover.
5. **CLAUDE.md / .claude/CLAUDE.md** still carry SJMS-2.5 phase-history content imported via the spine. The 0A2 brief deferred reframing those files to 0J, which didn't get to it. A future cleanup batch can rewrite, but no rush.
6. **`replace_all` glob.** When editing CODEOWNERS-style files where the same suffix appears on many lines, `replace_all: true` will clobber the catch-all line too. Use a small Python script for structural rewrites.
7. **`SECURE MODE: DO NOT run cdxgen with root privileges`.** The SBOM workflow (Phase 0M) needs `CDXGEN_NO_BANNER=1` or run as non-root. Currently advisory (`continue-on-error: true`) so doesn't block.
8. **`AuditAction` enum is `CREATE | UPDATE | DELETE | VIEW | EXPORT`** — no `EXECUTE`. Use `CREATE` for synthetic-subject audit rows (e.g. cron-run records).

---

## 7. The handover prompt to paste

When opening the new Claude Code session, paste the prompt at the top of [§8 below](#8-handover-prompt-for-the-new-claude-session). It's self-contained and short enough to fit in one paste.

---

## 8. Handover prompt for the new Claude session

```
You are continuing work on SJMS-5 (RJK134/SJMS-5), the Future Horizons
Education UK Higher Education Student Journey Management System (Version 5),
in convergence with operator Richard Knapp (@RJK134).

PILOT ANCHOR: Future Horizons Education (FHE) University — a synthetic-mirror
UK HE institution matching SITS / Banner deployment shape. Comprehensive
synthetic dataset on the operator's Google Drive at richardknapp134@gmail.com
(rclone remote gdrive5tb:sjms-5-dataset/).

READ FIRST, in order:
  1. docs/handover/SESSION-HANDOVER-2026-05-19.md  (the canonical handover)
  2. docs/operations/operator-action-register.md   (external-action ledger)
  3. docs/SJMS-5-SYNTHESIS-PLAN.md                  (master 12-phase plan)
  4. docs/SJMS-5-PLAN-AMENDMENTS-2026-05-16.md      (wins on touched sections)
  5. docs/SJMS-5-BUILD-QUEUE.md                     (per-phase batch ledger)
  6. docs/SJMS-5-OPERATING-MODEL.md                 (§13 + §14 are critical)
  7. docs/SJMS-5-KNOWN-ISSUES.md                    ("Phase 0 — COMPLETE" header)
  8. docs/architecture/outbox-worker-hosting.md     (Railway worker decisions)

CURRENT STATE on main (commit 0e2761f or later):
  - Phase 0 COMPLETE: 14 canonical batches merged. Spine + rebrand + supply-chain
    + Keycloak MFA + JWT fail-closed + governance + outbox + cryptobox + BullMQ
    scaffolding + Dependabot + n8n header fix + LICENSE + k6 nightly all in.
  - Phase 1 IN FLIGHT: 1A in PR #81 draft (this batch), 1H + 1I on branches.
  - Verification: tsc clean (after prisma generate), 740 vitest tests, prisma
    schema valid.

NEXT: Phase 1 — Finance closeout. Batches 1B–1G remaining (1A done in PR #81;
1H + 1I in flight). 1B (Sponsors + SponsorAgreement, FINANCE-gated) is the
natural next batch — see SJMS-5-BUILD-QUEUE.md Phase 1 section.

OPERATING MODEL non-negotiables:
  - One phase branch from main (or one sub-branch per batch — PR #67–#73 pattern)
  - PR opens as DRAFT; operator merges manually per §14
  - British English (enrolment, programme, colour, centre)
  - Prisma-backed only; audit + outbox event on every mutation
  - No direct Prisma in services (Gate 4)
  - Operator runs no local Docker/npm/prisma — every change deploys via Vercel
    from main and/or via Railway worker host

STOP-GATES the next session must respect:
  - Phase 2 (multi-tenancy) — operator design-doc approval required
  - Phase 5 — touching roles.ts is STOP-gated
  - Phase 11 (AI-native) — independent ethics review required
  - Phase 12 — external pentest + SAML + DR + DPIA + cosign before pilot

OPERATOR ACTIONS PENDING (see operator-action-register.md for the full list):
  - Replace @SECOND_OWNER in .github/CODEOWNERS with Freddie's GitHub login
  - Set GitHub repo description (Settings → General)
  - Apply codified branch protection (two gh api commands)
  - Stand up Railway worker host per docs/architecture/outbox-worker-hosting.md
  - Configure Keycloak sjms-5-load-test client; set SMTP password
  - Enable Dependabot alerts (repo Settings → Code security)

START HERE:
  1. git fetch --all && check open PRs via mcp__github__list_pull_requests
  2. Verify main is healthy: prisma generate, tsc, vitest
  3. Pick batch 1B from SJMS-5-BUILD-QUEUE.md Phase 1 section
  4. Branch as phase-1b/sponsors-and-agreements from main
  5. Ship batch by batch — one PR per batch, draft, evidence pack at
     evidence/phase-1/1X-<slug>.md, operator merges manually
```

---

## 9. What I did NOT do this session (and why)

For full transparency:

- **CLAUDE.md / .claude/CLAUDE.md rewrite** — both still carry imported SJMS-2.5 phase-history content. Reframing was deferred to 0J (which closed without doing it). Not blocking, but a future cleanup batch should rewrite. Skipped this session because the value is low vs the effort.
- **Phase 1B / 1C / 1D batches** — natural next moves after 1A but skipped to leave room for the new session.
- **0M Trivy workflow fix** — the Trivy / SBOM / Checkov jobs on PR #42 (now merged) ran but failed at runtime. All marked `continue-on-error: true` so advisory. Operator can iterate at leisure; no longer blocking.
- **Operator settings work** — explicitly NOT Claude's scope per operating-model §13.

---

## 10. Last commit context

- Last commit on `main` at handover: **`0e2761f`** (`phase-0c: cryptobox primitive + MinIO 4-bucket layout (#73)`)
- This handover branch: `docs/handover-2026-05-19`
- PR for this handover doc: opens after commit
- Session token / personality: previous session was Claude Opus 4.7 (1M context). Next session should run on the latest available model per the operator's preference.

End of handover.
