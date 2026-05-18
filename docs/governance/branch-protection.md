# Branch protection apply runbook

> **Audience:** repository administrator with `admin:repo` scope on
> `RJK134/SJMS-2.5`.
> **Source of truth:** `scripts/governance/protection.json`.
> **Companion docs:** `GOVERNANCE.md` (the policy) and
> `.github/workflows/governance-drift.yml` (the drift detector).
> **Last updated:** 2026-04-29

This runbook is the **apply step** for the codified branch
protection. The governance PR that introduces or updates
`scripts/governance/protection.json` does **not** apply the policy;
it just versions it. A maintainer with admin scope must run the
commands below to push the policy live.

---

## Apply prerequisites

1. You are on the merge SHA of the most recent governance PR
   (`git fetch && git checkout main && git pull`).
2. Your `gh` CLI is authenticated as a user with `admin:repo` scope
   on `RJK134/SJMS-2.5`. Verify with:
   ```bash
   gh auth status
   gh api repos/RJK134/SJMS-2.5 -q '.permissions.admin'   # must be true
   ```
3. The CI checks named in `protection.json::required_status_checks.contexts`
   exist as actual workflow run names. Verify with:
   ```bash
   gh api repos/RJK134/SJMS-2.5/commits/main/check-runs \
     -q '.check_runs[].name' | sort -u
   ```
   Every value in `contexts` must appear in the output. If a name
   does not appear, do **not** apply — fix the workflow first or the
   protection rule will permanently block merges.

## Apply

The apply is **two API calls**. GitHub's
`PUT /repos/{owner}/{repo}/branches/{branch}/protection` endpoint
covers most of the policy in `protection.json`, but
`required_signatures` is managed by a dedicated endpoint
(`POST .../protection/required_signatures`) and is silently ignored
if included in the PUT body. The first drift run after apply will
flag drift until both steps are run.

```bash
# Step 1 — push the main protection rule. This sets every field in
# protection.json EXCEPT required_signatures (see _comment_required_signatures
# in the JSON itself).
gh api -X PUT \
  -H 'Accept: application/vnd.github+json' \
  /repos/RJK134/SJMS-2.5/branches/main/protection \
  --input scripts/governance/protection.json

# Step 2 — enable required signed commits. This is a separate
# endpoint that takes no body. Skipping this step leaves signed
# commits unenforced and the drift workflow will (correctly) report
# the mismatch on the next run.
gh api -X POST \
  -H 'Accept: application/vnd.github+json' \
  /repos/RJK134/SJMS-2.5/branches/main/protection/required_signatures

# Verify by reading the combined live config back.
gh api /repos/RJK134/SJMS-2.5/branches/main/protection \
  > /tmp/live-protection.json
# Confirm signed commits enabled:
jq '.required_signatures.enabled' /tmp/live-protection.json   # should be `true`

# Trigger the drift workflow on demand to confirm zero drift.
gh workflow run governance-drift.yml --ref main
gh run watch --exit-status $(gh run list --workflow=governance-drift.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

If `governance-drift` exits 0, the apply is complete. Record the
commit SHA, the run URL, and the apply timestamp in
`evidence/branch-protection-apply-<YYYY-MM-DD>.json` (the schema is
in `evidence/README.md`).

### Disabling required signatures (emergency only)

To disable signed commits as part of a break-glass procedure
(per `GOVERNANCE.md` §6), use the `DELETE` form of the same
endpoint:

```bash
gh api -X DELETE \
  -H 'Accept: application/vnd.github+json' \
  /repos/RJK134/SJMS-2.5/branches/main/protection/required_signatures
```

The drift workflow will flag drift on the next run until signatures
are re-enabled via Step 2 above.

## What the apply step changes

The `PUT` call sets every field listed in `protection.json`. The
specific changes from the previous baseline (captured in
`evidence/branch-protection-baseline-2026-04-29.json`) are:

| Field                                         | Before        | After (codified)                    |
| --------------------------------------------- | ------------- | ----------------------------------- |
| `enforce_admins`                              | `false`       | `true`                              |
| `required_signatures`                         | `false`       | `true`                              |
| `required_pull_request_reviews.required_approving_review_count` | `1` | `1` (unchanged; ratchets to 2 once a second CODEOWNER is named) |
| `required_pull_request_reviews.require_last_push_approval` | unset | `true`                              |
| `required_status_checks.contexts`             | `[]` or unset | `["Quality gate", "governance-drift", "GitGuardian Security Checks"]` |
| `required_status_checks.strict`               | `false`       | `true`                              |
| `required_linear_history`                     | `false`       | `true`                              |
| `required_conversation_resolution`            | `false`       | `true`                              |
| `allow_force_pushes`                          | `true`        | `false`                             |
| `allow_deletions`                             | `true`        | `false`                             |

(Fill in the actual `Before` values from the baseline evidence after
running `gh api repos/RJK134/SJMS-2.5/branches/main/protection`. The
table above is illustrative; the real baseline is captured by the
admin who runs the apply.)

## Risks and rollback

The apply has the following risks:

1. **Existing in-flight PRs.** Any PR open when the policy goes live
   that does not yet satisfy the new rules (linear history, signed
   commits, CODEOWNERS approval, conversation resolution) will be
   blocked from merging until it does. Communicate the apply window
   in advance.
2. **Required-check name typos.** A typo in `protection.json::required_status_checks.contexts`
   produces a context that never reports, blocking every merge.
   The `governance-drift` workflow does not detect typos — the
   verify step in **Apply prerequisites** is the safeguard.
3. **Signed-commit cutover.** Contributors without GPG/SSH signing
   configured will start failing the gate. Distribute
   `docs/governance/signing-setup.md` (TODO — see Open follow-ups)
   before the apply if any contributor's existing commit history
   is unsigned.
4. **Admin bypass removal.** `enforce_admins = true` removes the
   ability to push directly to main even as an admin. The
   break-glass procedure in `GOVERNANCE.md` §6 is the only authorised
   path for emergency changes after the apply.

### Rollback

The apply is reversible by re-running `PUT` with the prior baseline
JSON, or by deleting the protection rule outright:

```bash
gh api -X DELETE /repos/RJK134/SJMS-2.5/branches/main/protection
```

A rollback is itself a governance event and requires:

- An `incident:` issue opened before the rollback executes.
- A post-hoc review within 5 working days (per `GOVERNANCE.md` §6).
- A new PR re-codifying the policy and a fresh apply run.

## Open follow-ups

1. **Signing setup guide.** Add `docs/governance/signing-setup.md`
   with GPG and SSH-signing walkthroughs and a check-in step
   (`git log --show-signature -n 5`). Sequenced to the same PR that
   first ratchets `required_approving_review_count` to `2`.
2. **Second reviewer in CODEOWNERS.** The bus-factor-1 condition is
   the single biggest residual risk. Onboarding a second human
   reviewer is the first action that should follow this PR landing.
3. **Required-check ratchet.** As `Lint (advisory)`, `npm audit`, and
   `CodeQL` move out of advisory status, add their workflow names
   to `protection.json::required_status_checks.contexts` in a
   dedicated PR and re-apply via this runbook.
