# GitHub Actions — repository secrets checklist

Configure secrets in the GitHub UI:

**Settings → Secrets and variables → Actions → New repository secret**

(Organisation-level secrets may also be used if your org policy maps them into this repository.)

This list covers workflows under `.github/workflows/` that **fail fast** or cannot run without the named secret. Other workflows use only `GITHUB_TOKEN`, which Actions injects automatically.

| Workflow | Job / area | Secret | Purpose |
| --- | --- | --- | --- |
| `cursor-agent.yml` | `invoke` | `CURSOR_API_KEY` | Cursor Background Agents API (`https://api.cursor.com`). Verified in-workflow before dispatch. |
| `cursor-agent-manual.yml` | (dispatch) | `CURSOR_API_KEY` | Same as above for manual agent runs. |
| `claude-code-review.yml` | `claude-review` | `CLAUDE_CODE_OAUTH_TOKEN` | `anthropics/claude-code-action` OAuth token for PR review. Alternatively some setups use direct API keys via sibling workflows. |
| `claude.yml` | (per file) | `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code automation using the Anthropic action. |
| `claude-code-fix.yml` | (per file) | `ANTHROPIC_API_KEY` | Direct Anthropic API path for fix automation. |
| `preview-smoke.yml` | (per file) | `INTERNAL_SERVICE_KEY` | Authenticated smoke calls against the preview API. |
| `k6-nightly.yml` | (per file) | `K6_BASE_URL` | Target base URL for load tests. |
| `phase-0a-bootstrap-spine.yml` | (per file) | `SJMS_V4_TOKEN` | Privileged `gh` token for bootstrap automation. |
| `dataset-ci.yml` | (per file) | `SJMS_V4_TOKEN` | Dataset pipeline Git access. |
| `scheduled-refresh.yml` | (per file) | `SJMS_V4_TOKEN` | Scheduled refresh Git/API access. |
| `dataset-audit-anchor.yml` | (per file) | `GIST_TOKEN` | Writes audit anchor gist. |
| `lake-drift-detector.yml` | env block | `RCLONE_CONFIG_GDRIVE5TB_*` | Rclone remote configuration for drift detection (multiple secrets; see workflow file). |
| `governance-drift.yml` | optional | `GOVERNANCE_DRIFT_TOKEN` | Falls back to `GITHUB_TOKEN` when unset. |

**Notes**

- Missing optional integration secrets do not affect the **`CI`** workflow quality gate (`docs-truth`, `server-quality`, `client-quality`), which only needs a clean checkout and a valid `package-lock.json` in sync with `package.json` for `npm ci`.
- `CURSOR_API_KEY` and Claude-related secrets are **integration** credentials; add them when you want those checks to run successfully, not for local typecheck or Vitest.
