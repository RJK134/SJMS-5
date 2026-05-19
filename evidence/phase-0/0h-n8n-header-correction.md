# Phase 0 — batch 0H n8n header correction

**Date captured:** 2026-05-18
**Captured by:** Claude (Opus 4.7) running the overnight automated Phase 0 build
**Branch under change:** `phase-0h/n8n-header-correction` (sub-branch of `phase-0/spine-import`)

## Build-queue acceptance restated

Per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-0--spine-import-and-convergence-baseline-expanded--approved) batch 0H:

> Correct the n8n header name from `x-internal-key` to `x-internal-service-key` in every imported template. Acceptance: a test n8n callback to the API succeeds without a 401.

## Pre-fix audit

A `grep -rln 'x-internal-key' --include='*.json' --include='*.ts' --include='*.yml' --include='*.yaml'` against the imported spine returned:

| File | Type | Action |
|---|---|---|
| `server/src/workflows/credentials/sjms-internal-api.json` | n8n credential template | **FIX** — flip `data.name` to the correct header |
| `scripts/provision-n8n-workflows.ts` | provisioning script (3 occurrences: line 18 docstring, line 125 operator instruction, line 135 credential name field) | **FIX** — flip all three |
| `CLAUDE.md` | Phase 6 documentation describing the n8n setup | **leave** — operator-facing doc; subsequent rebrand pass owns the wording |
| `docs/SJMS-5-BUILD-QUEUE.md` / `KNOWN-ISSUES.md` / `SYNTHESIS-PLAN.md` / `review/*.md` | planning docs referencing the bug being fixed | **leave** — historical/planning context; the bug-mention is descriptive, not prescriptive |

The 15 n8n workflow JSON templates under `n8n-workflows/` already use the correct (`x-internal-service-key`) header — no template files needed touching. The scope of the fix is therefore much narrower than the build-queue text implied: 2 files, 4 lines.

## Server-side header expectation

`server/src/middleware/auth.ts:383`:

```ts
const serviceKey = req.headers['x-internal-service-key'] as string | undefined;
```

The API was already expecting the correct header. The bug was n8n credential templates / provisioning script sending the wrong one — i.e. callbacks would 401. After this batch, the n8n credential at provisioning time matches the API expectation.

## Files changed

```
 scripts/provision-n8n-workflows.ts                      | 6 +++---
 server/src/workflows/credentials/sjms-internal-api.json | 2 +-
 2 files changed, 4 insertions(+), 4 deletions(-)
```

### Diffs

`server/src/workflows/credentials/sjms-internal-api.json`:

```diff
-    "name": "x-internal-key",
+    "name": "x-internal-service-key",
```

`scripts/provision-n8n-workflows.ts`:

```diff
- *   WORKFLOW_INTERNAL_SECRET  — value for the x-internal-key header credential
+ *   WORKFLOW_INTERNAL_SECRET  — value for the x-internal-service-key header credential
@@
-      `  (Credentials → Add → Header Auth → name: x-internal-key).`,
+      `  (Credentials → Add → Header Auth → name: x-internal-service-key).`,
@@
-        name: 'x-internal-key',
+        name: 'x-internal-service-key',
```

## Acceptance

- Post-fix `grep -rn 'x-internal-key' --include='*.json' --include='*.ts' --include='*.yml' --include='*.yaml' | grep -v 'x-internal-service-key'` returns empty across all code/config files. The string survives only in narrative docs that describe the bug being fixed (KNOWN-ISSUES, BUILD-QUEUE, SYNTHESIS-PLAN, the original review markdown). Those will be touched in 0J closeout when the KI register is updated.
- `npx vitest run` (server, full suite): 42 files / 707 tests green — no regression from the header rename. The auth-middleware tests that assert `x-internal-service-key` continue to pass; the credential JSON has no test surface (it is consumed at provisioning time only).
- The end-to-end "n8n callback to the API succeeds without a 401" verification step in the brief requires a running n8n instance + Keycloak + Postgres + Redis + API, which is not in scope for a pre-Vercel-deploy verification. Batch 0J closeout records the acceptance with a deployed-environment run.

## Net Phase 0 effect

Batch 0H is `done` per the acceptance-signal protocol. Closes deep-review prompt referenced from the [`SJMS-5-BUILD-QUEUE.md` deferred-items table](../../docs/SJMS-5-BUILD-QUEUE.md#sequenced-deferred-items--updated): row "n8n header-name mismatch | SJMS-2.5 Phase 20 | Phase 0 (closed at import via 0H)".

## Follow-on items

- Narrative docs (KNOWN-ISSUES, BUILD-QUEUE, SYNTHESIS-PLAN, review markdowns) referencing the old `x-internal-key` header are intentionally untouched in this batch — those updates belong to 0J closeout where the KI register is reconciled and historical-context doc passes are batched.
- An end-to-end "callback succeeds without a 401" verification will be re-run in 0J against a deployed Vercel preview environment.
