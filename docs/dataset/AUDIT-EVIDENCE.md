# SJMS-5 Dataset Audit Evidence

External tamper-detection for the synthetic dataset, mirroring the
Maieus2 Phase 6 audit-evidence pattern (see Maieus2 PRs #103, #109, #114).

## Threat model

The lake at `gdrive5tb:sjms-5-dataset/` is reachable by anyone with the
rclone credentials. An attacker — or a misconfigured automation — could
alter a CSV in place, or replace a snapshot, between the time a
snapshot is generated and the time a downstream consumer pulls it. The
manifest.json embedded in each snapshot can be rewritten by the same
attacker, so it cannot self-attest.

The audit anchor breaks that loop: a copy of the manifest's hash and
identity fields is written to a public gist at the moment of generation.
The gist's commit history is owned by GitHub, not by us — an attacker
cannot rewrite it without compromising GitHub itself.

## What gets anchored

Every committed manifest (any file matching `docs/dataset/manifest-*.json`,
or `output/**/manifest.json` if the user opts to commit the output)
triggers `.github/workflows/dataset-audit-anchor.yml`, which appends one
JSON line per manifest to the gist:

```json
{
  "anchoredAt":     "2026-05-18T10:00:00Z",
  "gitSha":         "<commit-that-introduced-the-manifest>",
  "manifestPath":   "docs/dataset/manifest-2026-05-17.json",
  "manifestSha256": "<sha256 of the manifest file>",
  "contentSha256":  "<sha256 of the manifest with timestamps stripped + keys sorted>",
  "schemaHash":     "<v4-integrated schema hash captured at generation>",
  "totalRows":      5292376,
  "totalTables":    298,
  "seed":           "2026-05",
  "generatedAt":    "2026-05-17T19:40:11.653Z"
}
```

Two hashes are recorded for different purposes:

- **`manifestSha256`** — sha256 of the manifest file byte-for-byte.
  Tightest forensic match, but breaks across regens because the
  manifest contains `generatedAt` / `finishedAt` wall-clock fields.
- **`contentSha256`** — sha256 of the manifest with runtime-only
  fields stripped (`generatedAt`, `finishedAt`, `generatorCommit`)
  and keys recursively sorted
  (`jq -S 'del(.generatedAt, .finishedAt, .generatorCommit)'`).
  Stable across regens of the same logical snapshot — even when the
  generator code has changed but produces identical rows — so
  consumers verify primarily against this.

The verifier checks `contentSha256` first; a fallback `manifestSha256`
match still counts as anchored — it just means the lake's bytes are
the exact ones that were anchored, not merely the same logical snapshot.

## Setup (one-time)

1. **Create a public gist** owned by the `RJK134` account, with one
   file named `sjms-5-dataset-anchors.jsonl`. Initial content can be a
   single line describing the gist's purpose, e.g.:

   ```
   {"_comment":"SJMS-5 dataset anchor log — appended by github.com/RJK134/SJMS-5"}
   ```

2. **Mint a fine-grained PAT** scoped to `gist:write` on the
   `RJK134` user account. Save it as the **repo secret** `GIST_TOKEN`
   on `RJK134/SJMS-5`. Do not commit it.

3. **Record the gist ID** as the **repo variable** `AUDIT_ANCHOR_GIST_ID`
   (the hexadecimal slug from the gist URL, e.g.
   `https://gist.github.com/RJK134/<this-bit>`).

Until both are set the workflow runs in dry-mode — it computes the
record and uploads it as a 365-day artifact, but skips the gist write.

## Verifying a lake snapshot

Downstream consumers (Maieus2 importer, Shakespeare-is-Boring,
My-Course-Matchmaker) and auditors can independently verify a snapshot
against the anchor:

```sh
# Verify the current /latest/ snapshot
SJMS_ANCHOR_GIST_URL=https://gist.github.com/RJK134/<id> \
  node scripts/verify-lake-anchor.mjs \
    --source gdrive5tb:sjms-5-dataset/latest/

# Verify a local copy
node scripts/verify-lake-anchor.mjs \
  --source ./output/2026-05-17/ \
  --gist-url https://gist.github.com/RJK134/<id>
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | manifest.sha256 matches an anchor record — snapshot is consistent |
| 1 | matched record disagrees on `schemaHash` — tamper signal |
| 2 | no anchor matches this manifest — pre-anchor snapshot or tamper |
| 3 | usage / I/O error |

The verifier pulls only `manifest.json` from the lake, not the full
~800MB of CSVs — verification is cheap.

## Tamper-detection sites

Six places notice an inconsistency, in order of when an attacker would
encounter them:

1. **CI workflow** (`dataset-ci.yml`) — refuses non-deterministic
   generator output; an attacker editing the generator to leak data
   fails here.
2. **CI workflow** (`dataset-audit-anchor.yml`) — every committed
   manifest is published externally; an attacker editing the manifest
   after-the-fact diverges from the gist.
3. **Refresh script** (`scripts/refresh-snapshot.sh`) — manifest
   verification step refuses to push if `totalTables != 298`.
4. **Importer scaffold** (`scripts/import-sjms-dataset.mjs`) — refuses
   to import if `FORBIDDEN_COLUMNS` appears in any CSV header.
5. **Independent verifier** (`scripts/verify-lake-anchor.mjs`) — any
   consumer or auditor can pull-and-verify against the public gist.
6. **Scheduled drift detector**
   (`.github/workflows/lake-drift-detector.yml`) — runs the verifier
   every Tuesday 07:00 UTC against `gdrive5tb:sjms-5-dataset/latest/`.
   If `contentSha256` doesn't match an anchor record, opens a
   `drift`-labelled issue with the verifier output for triage.
   Requires `RCLONE_CONFIG_GDRIVE5TB_*` repo secrets for the runner to
   reach gdrive — without them the workflow runs in lean mode (skips
   verification with a clear warning).

An attacker would have to compromise: the local working copy, the CI
runner, the gist, AND every downstream consumer's verification step
simultaneously to evade detection. Each site is a separate trust
boundary.

## Related

- Maieus2 Phase 6 anchor pattern: `RJK134/Maieus2#103`, `#109`, `#114`.
- Workhorse datalake (the same threat model applies):
  `RJK134/Macbook` — though Workhorse currently relies on the upstream
  CSV's own integrity. SJMS-5 is the first dataset on this lake with
  explicit external anchoring.
