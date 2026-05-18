# Evidence pack

This directory holds machine-readable evidence records that auditors
can replay to verify the state of the repository at a point in time.

Each record is a JSON file named
`<topic>-<YYYY-MM-DD>[-<slug>].json` and conforms to the schema
`internal://sjms/evidence/v1`.

## Topics

| Topic                              | Source                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `branch-protection-baseline`       | `gh api repos/RJK134/SJMS-2.5/branches/main/protection` before apply    |
| `branch-protection-apply`          | The apply event itself (commit SHA, run URL, timestamp)                  |
| `branch-protection-drift`          | Output of `.github/workflows/governance-drift.yml` when drift is found  |
| `permission_blocked`               | Records when an automation could not perform a step due to scope         |
| `repo-collaborators`               | `gh api repos/RJK134/SJMS-2.5/collaborators` snapshot                    |

## Common shape

```json
{
  "$schema": "internal://sjms/evidence/v1",
  "topic": "<one of the topics above>",
  "capturedAt": "<ISO 8601 UTC>",
  "source": "<github-api | claude-code | cursor-agent | manual>",
  "actor": "<GitHub login or service account>",
  "context": {
    "repo": "RJK134/SJMS-2.5",
    "branch": "main",
    "commit": "<sha>"
  },
  "data": { ... }
}
```

## Why this is in the repo

- An auditor with read access to the repo can reconstruct the
  governance state without separate datastore access.
- The records are signed via the same commit-signing requirement as
  source code, so authorship is non-repudiable.
- A maintainer cannot quietly delete an inconvenient evidence record
  without a PR review.
