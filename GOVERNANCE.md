# Governance — SJMS 2.5

> **Audience:** maintainers, code reviewers, auditors, project lead.
> **Status:** authoritative. This document, together with `.github/CODEOWNERS`, `SECURITY.md`, and `scripts/governance/protection.json`, is the codified change-management policy for the `RJK134/SJMS-2.5` repository.
> **Last updated:** 2026-04-29

This file describes who can approve, how releases are cut, and how
admin bypass works. It is the single source of truth where it conflicts
with informal practice. Where it conflicts with regulatory obligations
(UK GDPR, Data Protection Act 2018, OfS, HESA, UKVI), the regulatory
obligation wins and this document must be updated.

---

## 1. Default branch and merge rules

The default branch is `main`. Direct pushes are forbidden.

Every change reaches `main` via a pull request from a feature branch.
Feature branches use one of these prefixes:

| Prefix                       | Owner                     | Purpose                                  |
| ---------------------------- | ------------------------- | ---------------------------------------- |
| `phase-<N>/<slug>`           | project lead              | numbered delivery phases                 |
| `chore/<slug>`               | any contributor           | tooling, docs, hygiene                   |
| `fix/<ki-id>-<slug>`         | any contributor           | targeted Known-Issue fixes               |
| `claude/blocker-<slug>`      | Claude Code               | blocker-prompt automation                |
| `cursor/blocker-<slug>`      | Cursor Background Agents  | blocker-prompt automation                |
| `dependabot/...`             | Dependabot                | automated dependency PRs                 |

Pull requests merge into `main` via **squash merge only**. Linear
history is enforced: rebase or merge commits are rejected.

## 2. Required reviewers

Every PR requires at least **one** approving review from a CODEOWNERS
maintainer of every modified path. The repository today has
**bus-factor 1** — only `@RJK134` is recorded as the maintainer of
record — so the codified review threshold is currently `1`.

The threshold ratchets to `2` as soon as a second reviewer is named
in CODEOWNERS. The ratchet is non-negotiable: a follow-on PR must
flip both `scripts/governance/protection.json::required_pull_request_reviews.required_approving_review_count`
to `2` and add the second reviewer to CODEOWNERS in the same change set.

While the threshold is `1`:

- Every PR description must include the attribution metadata block
  (see `.github/pull_request_template.md`) so the reviewer-of-record
  is recorded in git history.
- AI-assisted contributions (Claude Code, Cursor Background Agents,
  GitHub Copilot, BugBot) count as the **first** set of eyes, never
  the second. They cannot satisfy the human-review requirement.
- The reviewer cannot be the same human as the author. Self-approval
  is forbidden by branch protection (`require_code_owner_reviews`
  + `dismiss_stale_reviews`).

When BugBot or Copilot proposes a fix, that proposal must be reviewed
by a human. The AI tool cannot resolve its own review thread.

## 3. Required status checks

The following CI status checks are required on `main`:

| Check                          | Source workflow                          | Why it is required                                                       |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| `Quality gate`                 | `.github/workflows/ci.yml`               | Aggregator. Depends on `docs-truth`, `server-quality`, `client-quality`. Single point of enforcement so the protection rule does not have to enumerate every downstream job. |
| `governance-drift`             | `.github/workflows/governance-drift.yml` | Detects drift between live branch protection and `scripts/governance/protection.json`. |
| `GitGuardian Security Checks`  | GitGuardian (third-party)                | Blocks any commit that contains a leaked secret.                          |

The following checks run on every PR but are **advisory** (allowed to
fail without blocking merge) until their backlog item closes:

| Check               | Tracking issue   | Why advisory                                       |
| ------------------- | ---------------- | -------------------------------------------------- |
| `Lint (advisory)`   | KI-P14-001 / KI-P15-002 | ESLint baseline triage not yet performed.         |
| `npm audit`         | KI-P15-001       | Audit baseline not yet triaged.                    |
| `CodeQL`            | Phase 15A policy | Advisory until the project decides how to triage findings. |

Promoting an advisory check to a required check requires a PR that
modifies `scripts/governance/protection.json` and updates this table.

The required-checks list is **strict**: branches must be up-to-date
with `main` before merge. Stale branches must be rebased before the
required-checks evaluation runs.

## 4. Branch protection summary

The full machine-readable policy lives in
`scripts/governance/protection.json`. The summary:

| Setting                                              | Value                                                |
| ---------------------------------------------------- | ---------------------------------------------------- |
| Required PR reviews                                  | `1` (ratchets to `2` when a second reviewer is in CODEOWNERS) |
| Dismiss stale reviews on push                        | `true`                                               |
| Require review from CODEOWNERS                       | `true`                                               |
| Required status checks                               | `Quality gate`, `governance-drift`, `GitGuardian Security Checks` |
| Strict status-check requirement (up-to-date branch)  | `true`                                               |
| Require signed commits                               | `true`                                               |
| Require linear history                               | `true`                                               |
| Allow force pushes                                   | `false`                                              |
| Allow deletions                                      | `false`                                              |
| Enforce admins (no admin bypass)                     | `true`                                               |
| Require conversation resolution before merging       | `true`                                               |

## 5. Signed commits

All commits to `main` (and therefore every commit on every feature
branch that is later merged) must be cryptographically signed.

- GPG signing and SSH signing are both accepted.
- The signing identity must match a verified email on the GitHub
  account of the committer.
- Lost or revoked signing keys must be replaced before the
  contributor can merge again. Unsigned commits made on a feature
  branch must be rebased and re-signed before opening or updating
  the PR.

Signing is enforced by **branch protection** once an admin applies
`scripts/governance/protection.json` (see `docs/governance/branch-protection.md`).
The `governance-drift` workflow does not replace GitHub's signature
verification; it diffs live protection against the JSON so
`required_signatures` cannot drift silently. A contributor setup guide is
tracked in `docs/governance/branch-protection.md` (Open follow-ups) pending
`docs/governance/signing-setup.md`.

## 6. Break-glass admin bypass

`enforce_admins = true` removes routine admin bypass. The procedure
below is the **only** authorised way to bypass branch protection.
Each step is mandatory. Skipping any step is a governance incident.

### When break-glass is allowed

1. A live security incident requires an immediate fix (e.g. a
   credential leak that GitGuardian flagged after merge).
2. CI is broken in a way that prevents any PR from passing the
   required checks (e.g. a runner outage that has lasted more than
   60 minutes), and a fix-forward PR is needed to unblock the
   pipeline.
3. A regulatory obligation (UKVI, OfS) requires a change inside a
   deadline that pre-empts the normal review window.

Break-glass is **not** appropriate to:

- ship a feature ahead of schedule,
- avoid a rebase or merge conflict,
- bypass a failing test the contributor believes is flaky.

### Procedure

1. The maintainer with admin rights opens an issue titled
   `break-glass: <one-line reason>` **before** disabling protection,
   linking to the incident, the regulatory obligation, or the CI
   outage that justifies the bypass.
2. The maintainer disables `enforce_admins` (or a specific required
   check) for the **shortest possible window** and records the start
   time in the issue.
3. The maintainer pushes the fix-forward commit and re-enables every
   bypassed setting. The end time goes in the issue.
4. Within 5 working days, the maintainer files a written post-hoc
   review in the issue covering: what was bypassed, why, what
   evidence shows the change was correct, and what process change
   (if any) prevents a repeat.
5. The post-hoc review is linked from `docs/governance/incidents/`
   and from the next monthly governance summary.

The `governance-drift` workflow detects drift within 24 hours (it runs
nightly): if the live config does not match the codified config, the run
fails and leaves a trace in Actions logs and (when the fetch succeeds)
the uploaded live-protection snapshot artifact. That failure is the
auditor's primary evidence trail.

## 7. Conventional commits and merge titles

PR titles follow the conventional-commit form
`<type>(<scope>): <description>`.

`<type>` is one of: `feat`, `fix`, `refactor`, `chore`, `docs`,
`test`, `ci`, `perf`, `style`, `revert`. `<scope>` is the affected
module or domain (e.g. `admissions`, `phase-16`, `governance`).

The **squash-merge commit message** uses the PR title verbatim. The
PR description becomes the squash commit body.

## 8. Releases

Phase releases are tagged on `main` as `phase-<N>-complete` once the
phase PR is merged and the verification protocol passes. Tags are
created by a maintainer with admin rights; tag creation is **not**
delegated to AI agents.

Hotfix releases are tagged as `hotfix-<YYYY-MM-DD>-<slug>` and follow
the break-glass procedure when they pre-empt the normal phase cadence.

## 9. AI-assisted contributions

The platform uses several AI assistants (Claude Code, Cursor
Background Agents, GitHub Copilot, Cursor BugBot). All AI-generated
contributions are subject to the same merge gate as any other
contribution: human review, signed commits, passing required checks.

Two additional rules apply to AI contributions:

1. **Attribution.** The PR description must include the attribution
   metadata block (see `.github/pull_request_template.md`) listing
   every AI tool that produced the diff. Auditors must be able to
   trace authorship.
2. **No self-merge.** AI tools must never click the merge button.
   This is enforced organisationally; the merge action is reserved
   to a human maintainer.

The repository protects the auth surface and Prisma schema with
explicit STOP conditions for AI agents (see `CLAUDE.md`). AI agents
that detect they are about to violate a STOP condition must halt and
ask a human.

## 10. Drift detection

`scripts/governance/protection.json` is the codified policy.
`.github/workflows/governance-drift.yml` runs nightly and on every
push to `main` (and on PRs targeting `main`). It fetches the live
branch-protection config from the GitHub API when the token has
sufficient scope and diffs it against the JSON. Any drift fails the
check; results appear in GitHub Actions logs, and a live-protection
snapshot is uploaded when the fetch returns JSON. It does **not**
post comments on PRs or open issues automatically.

Two consequences flow from this:

- A maintainer cannot quietly relax protection in the GitHub UI
  without leaving a trail.
- The codified JSON cannot quietly diverge from reality without the
  next nightly run flagging it.

## 11. Updating this document

Any change to this document, to `.github/CODEOWNERS`, or to
`scripts/governance/protection.json` requires:

1. A PR titled with the `chore(governance):` or `feat(governance):`
   prefix.
2. CODEOWNERS approval (the governance paths are owned).
3. A passing `governance-drift` run against the proposed JSON.
4. The attribution metadata block in the PR description.

The protection rule cannot be relaxed in the same PR that introduces
a feature. Governance changes ship on their own.
