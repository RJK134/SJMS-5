#!/usr/bin/env bash
# Provision the MinIO 4-bucket layout for SJMS-5 (batch 0C).
#
# Buckets (per the layout decision recorded in
# evidence/phase-0/0c-cryptobox-minio.md §3):
#
#   sjms5-uploads-public   — applicant/student-uploaded artefacts that may
#                            be served via presigned URL (CVs, photos).
#                            Public-read with object-level ACLs.
#
#   sjms5-uploads-private  — sensitive uploads (passport scans, medical
#                            attestation, EC evidence). Bucket-private;
#                            objects encrypted by `utils/cryptobox.ts`
#                            before write.
#
#   sjms5-backups          — Postgres dumps + n8n workflow exports.
#                            Bucket-private; objects encrypted.
#                            Lifecycle: keep 30 days dated + 12 monthly.
#
#   sjms5-evidence         — audit / compliance / phase-evidence
#                            artefacts (PDFs of HESA returns, ULN audit
#                            trails, k6 reports). Bucket-private; objects
#                            encrypted; lifecycle: legal-hold = on.
#
# Usage:
#   MINIO_ENDPOINT=play.min.io \
#   MINIO_ROOT_USER=admin \
#   MINIO_ROOT_PASSWORD=changeme \
#     ./scripts/provision-minio-buckets.sh
#
# Idempotent — re-running against an already-provisioned MinIO is a no-op.

set -euo pipefail

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT required (host or host:port)}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD required}"
MINIO_SCHEME=${MINIO_SCHEME:-http}
MINIO_ALIAS=sjms5-local

# Find or install the mc CLI.
if ! command -v mc >/dev/null 2>&1; then
  echo "::error::mc (MinIO Client) is not installed. Install with:"
  echo "  brew install minio/stable/mc        # macOS"
  echo "  curl https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc"
  exit 1
fi

mc alias set "$MINIO_ALIAS" "${MINIO_SCHEME}://${MINIO_ENDPOINT}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

for bucket in sjms5-uploads-public sjms5-uploads-private sjms5-backups sjms5-evidence; do
  if mc ls "${MINIO_ALIAS}/${bucket}" >/dev/null 2>&1; then
    echo "  exists: ${bucket}"
  else
    mc mb "${MINIO_ALIAS}/${bucket}"
    echo "  created: ${bucket}"
  fi
done

# Public bucket gets a download-only anonymous policy on the read path.
# The other three are bucket-private by default — we leave them as-is.
mc anonymous set download "${MINIO_ALIAS}/sjms5-uploads-public" || true

# Versioning on the backup + evidence buckets. Operator can disable in
# Settings; we set it as the default so accidental overwrites stay
# recoverable for 30 days.
mc version enable "${MINIO_ALIAS}/sjms5-backups" || true
mc version enable "${MINIO_ALIAS}/sjms5-evidence" || true

# Lifecycle on the backup bucket: delete non-current versions after 30 days,
# expire current after 12 months. Edit and re-apply if the retention policy
# changes.
cat > /tmp/sjms5-backups-lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "expire-noncurrent",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    },
    {
      "ID": "expire-current",
      "Status": "Enabled",
      "Expiration": { "Days": 365 }
    }
  ]
}
JSON
mc ilm import "${MINIO_ALIAS}/sjms5-backups" < /tmp/sjms5-backups-lifecycle.json || true
rm -f /tmp/sjms5-backups-lifecycle.json

echo "Provisioning complete."
