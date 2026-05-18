#!/usr/bin/env bash
#
# refresh-snapshot.sh — regenerate the synthetic dataset and push it to
# the gdrive5tb lake at both /<DATE>/ and /latest/.
#
# Intended cadence: weekly (Monday mornings), invoked via the `/schedule`
# remote routine. Manual invocation supported for off-cycle refreshes.
#
# Usage:
#   scripts/refresh-snapshot.sh                 # today's date, seed 'YYYY-MM'
#   scripts/refresh-snapshot.sh 2026-05-17       # specific date, seed 'YYYY-MM'
#   scripts/refresh-snapshot.sh 2026-05-17 special-seed
#
# Exit codes: 0 success, non-zero on any step failure (no partial pushes).
#
# Required: pnpm, rclone (with the `gdrive5tb:` remote configured),
# Node ≥ 18.

set -euo pipefail

DATE="${1:-$(date -u +%Y-%m-%d)}"
SEED="${2:-$(echo "$DATE" | cut -c1-7)}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/output/$DATE"
LOG_FILE="$OUT_DIR/refresh.log"
LAKE_DATED="gdrive5tb:sjms-5-dataset/$DATE/"
LAKE_LATEST="gdrive5tb:sjms-5-dataset/latest/"

cd "$REPO_ROOT"

# Pre-flight: rclone remote must exist, or the push step will silently
# create a directory in a wrong location.
if ! rclone listremotes 2>/dev/null | grep -q '^gdrive5tb:$'; then
  echo "FATAL: rclone remote 'gdrive5tb:' not configured." >&2
  echo "Run 'rclone config' to add it before retrying." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "===== refresh-snapshot $(date -u +%FT%TZ) ====="
echo "  date:   $DATE"
echo "  seed:   $SEED"
echo "  out:    $OUT_DIR"
echo "  lake:   $LAKE_DATED  +  $LAKE_LATEST"
echo

echo "==> Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

echo "==> Running generator"
SJMS_DATASET_SEED="$SEED" \
  node scripts/generate-synthetic-dataset.mjs \
    --out "$OUT_DIR" --seed "$SEED"

echo "==> Verifying manifest"
node -e "
  const m = require('$OUT_DIR/manifest.json');
  if (m.totalTables !== 298) {
    console.error('expected 298 tables, got ' + m.totalTables);
    process.exit(1);
  }
  console.log('OK ' + m.totalTables + ' tables / ' + m.totalRows.toLocaleString() + ' rows');
  console.log('   schemaHash ' + m.schemaHash);
"

echo "==> Syncing to $LAKE_DATED"
rclone sync "$OUT_DIR/" "$LAKE_DATED" \
  --transfers 8 --checkers 16 --stats 30s --stats-one-line \
  --exclude 'refresh.log'

echo "==> Mirroring to $LAKE_LATEST"
rclone sync "$OUT_DIR/" "$LAKE_LATEST" \
  --transfers 8 --checkers 16 --stats 30s --stats-one-line \
  --exclude 'refresh.log'

echo
echo "===== refresh complete $(date -u +%FT%TZ) ====="
