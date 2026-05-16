# SJMS-5 — Enterprise Delivery Operating Model

> **Effective:** on Phase 0 merge.
> **Inherited from:** SJMS-2.5 enterprise-delivery operating model (effective 2026-04-22), with SJMS-5 additions §10–§14.

---

## 1. Principles

1. **Honest documentation.** README and CLAUDE.md describe **what's actually built today**, not the roadmap. The `docs:check` script enforces this against repo state and is mandatory in CI.
2. **Architectural integrity before functional breadth.** SJMS-5's competitive advantage is structural — flat routers + group barrels, repository layer, Zod-driven OpenAPI, structured observability, tenant-by-default, AI-grounded. Do not trade these for speed.
3. **STOP-gates for architecturally significant changes.** Any change to `auth.ts`, the role catalogue, the Keycloak realm, the multi-tenancy contract, an established Prisma relationship, or any AI use case **requires a design doc + operator sign-off** before code lands.
4. **One active phase branch from `main` at a time.** Stacked branches for batches within a phase are acceptable; concurrent phases are not.
5. **PR-per-branch.** One session = one branch = one PR. Follow-up fixes update the existing PR, not a new one.
6. **British English throughout.** Code, comments, documentation, commit messages.
7. **Prisma-backed persistence only.** No in-memory stores in the shipped code path. Test doubles are fine inside `*.test.ts`.
8. **Audit + webhook on every mutation.** Every state change produces an audit-log row and a webhook event published through the `x-internal-service-key`-corrected n8n channel.

## 2. Phase lifecycle

1. **Phase opens** with a control-set update (CLAUDE.md, build queue, known issues, this operating model if applicable, the phase's design doc if STOP-gated).
2. **Batches.** 3–8 reviewable batches per phase. Each batch is a single coherent change.
3. **Verification protocol after every batch:** typecheck (server + client), Prisma validate, full Vitest suite, advisory lint, advisory coverage, advisory CodeQL, advisory npm audit, advisory k6.
4. **`report_progress` before the first edit and after every batch.**
5. **PR opens** as **draft**. Title describes the business outcome. Body lists the batches with commit SHAs and the testing evidence pointer.
6. **BugBot review.** Address every HIGH finding; LOW findings logged in `docs/KNOWN_ISSUES.md` with target phase.
7. **Phase closeout batch.** Update the control set, commit the evidence pack to `evidence/phase-N/`, then take PR out of draft.

## 3. Branch naming

| Pattern | Use |
|---|---|
| `phase-N/<slug>` | Canonical phase branch |
| `chore/<slug>` | Tooling / docs / infrastructure with no domain change |
| `fix/<slug>` | Targeted bug fix (out-of-phase) |
| `claude/<slug>-<short-id>` | Claude session branch — must roll up into a `phase-N/` branch before merge |

## 4. PR conventions

- Titles: business outcome, not technical action. **"Add sponsor agreements and bursary funds"** not **"Add Sponsor and Bursary models"**.
- Body: scope, batches with SHAs, verification evidence, BugBot status, KI register impact.
- Draft until the closeout batch lands.
- Merge: squash, with the PR title as the squash subject and the body as the squash body.
- Never merge with a HIGH BugBot finding open.

## 5. Commit conventions

Conventional-commits prefix, scope, imperative, British English. No emoji unless explicitly requested.

```
feat(finance): add bursary fund allocation rules
fix(admissions): correct offer-condition auto-promotion guard
chore(deps): pin Prisma to 6.19.3
docs(known-issues): close KI-P10b-001
```

## 6. STOP-gates

Any change that touches one or more of the following requires an approved design doc **before** code lands:

- `server/src/middleware/auth.ts`
- `server/src/constants/roles.ts`
- `docker/keycloak/fhe-realm.json`
- Established Prisma relationships (relation drops, type changes, removal of `tenantId`, removal of `deletedAt`)
- Multi-tenancy middleware contract
- AI use cases (any new Phase 11+ AI feature)
- The webhook event catalogue
- The OpenAPI versioned contract (`/api/v1/...`)

The design doc lives in `docs/design/<phase>-<topic>.md` and is committed to the same PR as the implementation.

## 7. Verification protocol

Gates inherited from SJMS-2.5, with SJMS-5 additions in italics:

1. server tsc clean
2. client tsc clean
3. Prisma validate
4. Repository layer is the only place that talks to `prisma.*`
5. Full Vitest suite green
6. ESLint advisory through Phase 2, **blocking from Phase 3**
7. Coverage at or above current floor
8. CodeQL no new HIGH findings
9. npm audit no new HIGH advisories
10. Hygiene: no `.claude/worktrees/` leaks, no stray chat transcripts
11. Security-observability: every new route has audit + webhook + rate limit
12. *(SJMS-5)* HERM tag on every new module barrel; **docs:check enforces**
13. *(SJMS-5)* k6 advisory result emitted on the nightly job
14. *(SJMS-5)* For Phase 11+ AI features only: model card committed + ethics-review reference + per-tenant kill-switch verified

## 8. Known-issue discipline

`docs/KNOWN_ISSUES.md` is a **living register of deliberately deferred defects**, not a TODO list. An entry requires:

- Issue ID (`KI-<phase>-<number>`)
- One-line description
- Reason for deferral (out of phase scope, blocked, accepted tech debt)
- Target resolution phase
- Closed-by reference when closed (commit SHA or PR)

## 9. Coverage ratchet

- Phase 0 starts at SJMS-2.5's ratcheted baseline: `lines:35, functions:16, branches:33, statements:35`.
- Each phase closeout ratchets all four by **+3 percentage points**, capped at `lines:70, functions:50, branches:50, statements:70` by Phase 10.
- Floors sit ~3pp below the suite's actuals on the closing branch so honest churn does not break CI.
- Single source: `server/vitest.config.ts`. CI does **not** override.

## 10. SJMS-5 addition — HERM tagging

Every new API module barrel (`server/src/api/<barrel>/index.ts`) must declare its HERM v3.1 capability tag in JSDoc:

```typescript
/**
 * @herm L2.6 Assessment, Moderation, Progression, Awards
 * @description Marks pipeline, moderation states, module result generation,
 *              progression decisioning, award classification, transcripts.
 */
export default router;
```

The `docs:check` script extracts the tag and verifies it matches the barrel's listed modules in [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) §4.2.

## 11. SJMS-5 addition — AI feature governance

Every Phase 11+ AI feature requires:

- A **model card** at `docs/ai/<feature>.md` listing: use case, model ID (e.g. `claude-opus-4-7`), system prompt version, retrieval scope, prompt-caching strategy, kill-switch path, audit retention, ethics review reference, opt-out per tenant.
- An **audit log entry on every invocation** with: model ID, prompt hash, response hash, user, tenant, action taken (accepted / edited / rejected). 7-year retention.
- A **kill-switch per tenant** in the `Tenant` model's `aiFeatures` JSON column.
- **Independent ethics review** for any feature that touches student records, admissions decisions, or financial decisions.

## 12. SJMS-5 addition — migration justification

Every Prisma model mutation (add, rename, drop) in `prisma/migrations/` requires a one-line note at the top of the migration file justifying the change. This includes `0001_init`-era retroactive justifications, because the `0001_init` migration is itself a convergence artefact rather than the natural evolution of either source repo.

## 13. SJMS-5 addition — operator constraints

Richard runs every build via Vercel auto-deploy from `main` and does **NOT** run local Docker, npm, prisma, or terminal commands. CI-green on a PR is necessary but not sufficient — verify changes against the deployed Vercel + Neon stack where possible (preview deploys).

Vercel deploys the API server as a serverless function — there is **no startup hook**. Anything that must happen once per deploy goes in the build command (`server/vercel.json`), not `npm start`.

BullMQ workers do **not** run on Vercel (no long-running process). Workers run on a dedicated long-running host (Railway / Render / Fly) that dequeues from the same Redis used by the API. The Vercel-hosted API only enqueues.

## 14. SJMS-5 addition — auto-merge policy

**Effective:** from Phase 0 batch 0N closeout (when BugBot or equivalent automated PR-review bot is wired and Dependabot alerts enforcement is live).

**Pre-conditions** (set up once on the SJMS-5 repository, all operator-driven):

- **Settings → General → Pull Requests:** ☑ Allow auto-merge. ☑ Allow squash merging. (Optionally disable Merge commits / Rebase merging to enforce squash-only per §4.)
- **Settings → Branches → Branch protection rule for `main`** (this is also Phase 0 batch 0K):
  - ☑ Require a pull request before merging — minimum 1 approving review.
  - ☑ Require review from Code Owners (CODEOWNERS file is added in 0K).
  - ☑ Require status checks to pass before merging — with these required as soon as they exist: `CI` (typecheck + tests), `CodeQL`, `Security audit (npm)`, `Security meta-check (Dependabot enabled)`, `Container scan (Trivy)`, `SBOM (CycloneDX)`, `BugBot review` (or chosen equivalent).
  - ☑ Require branches to be up to date before merging.
  - ☑ Require conversation resolution before merging.
  - ☑ Require signed commits.
  - ☑ Require linear history.
  - ☑ Do not allow bypassing the above settings (operator-included).
- **Repository settings → Code security and analysis:** ☑ Dependabot alerts on. ☑ Dependabot security updates on. ☑ Secret scanning on. ☑ Push protection on.

**Pre-Phase 0N posture (now until 0N merges):**

- Auto-merge **NOT** enabled by Claude on any PR. There is no meaningful CI gate yet (only GitGuardian); auto-merge would reduce to "merge on take-out-of-draft", removing the human gate without adding any automated safety.
- Each PR is merged by the operator manually after inline review.
- Claude responsibilities per PR: open as draft, push commits, surface CI results when they arrive, take PR out of draft only when explicitly told.

**Post-Phase 0N posture (default-on after 0N closeout):**

- For every Claude-opened PR on a non-STOP-gated phase: once the closeout batch lands, Claude takes the PR out of draft and calls `enable_pr_auto_merge` with `merge_method: "squash"`.
- Auto-merge fires only when **all** of these are true (enforced by the branch-protection ruleset):
  - Every required status check is green (CI, CodeQL, npm audit, security-meta-check, container-scan, SBOM, BugBot).
  - The required number of approving reviews is met.
  - All conversations on the PR are resolved.
  - The branch is up to date with `main`.
  - No signed-commit / linear-history violation.
- Auto-merge **NEVER fires** for any of the following — these are operator-merged manually:
  - **STOP-gated phases** (Phase 2 multi-tenancy, Phase 11 AI-native uplift, Phase 12 pilot readiness). Operator-merged after design doc + ethics review.
  - **STOP-gated batches inside other phases** (e.g. Phase 5 `employer_admin` Keycloak role addition touches `roles.ts`; Phase 1H optimistic-locking touches established Prisma relationships).
  - **Any PR with a HIGH BugBot finding.** Claude does not call `enable_pr_auto_merge` when BugBot has open HIGH findings; Claude fixes first, then re-enables.
  - **`chore/auto-merge-*` PRs themselves.** Self-referential changes to this policy are operator-reviewed.
  - **Any PR the operator instructs Claude not to auto-merge.**
- The operator may revoke auto-merge on any specific PR by replying "disable auto-merge on PR #N". Claude calls `disable_pr_auto_merge` and the PR reverts to operator-merged.

**Override hierarchy** (most specific wins):

1. Operator instruction in the current conversation.
2. STOP-gate flag on the phase or batch.
3. HIGH BugBot finding.
4. Default auto-merge enabled (post-0N).

**Audit trail.** Every `enable_pr_auto_merge` / `disable_pr_auto_merge` call by Claude is logged in the session transcript with the trigger reason ("closeout batch landed", "HIGH finding cleared", "operator instruction"). The squash-merge commit on `main` is the final audit point.

**Why it isn't immediate.** Auto-merge accelerates the loop only when the gates it waits on are meaningful. Until Phase 0N wires CI, CodeQL, npm audit, security-meta-check, container-scan, SBOM, and BugBot as required checks, auto-merge would degenerate to "merge instantly on out-of-draft" — strictly worse than operator-reviewed manual merge. The policy explicitly defers activation until the gates exist.

---

*End of operating model. See [`SJMS-5-BUILD-QUEUE.md`](SJMS-5-BUILD-QUEUE.md) for the phase ledger and [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) for the master plan.*
