# Batch 0C — MinIO + AES-256-GCM + cryptobox

> **Captured:** 2026-05-19
> **Companion to:** [`docs/phase-0/README.md`](../../docs/phase-0/README.md) batch 0C row.
> **Closes:** KI-S5-304 (plaintext secrets in JSON / no secrets-at-rest primitive).

## 1. Why an envelope cryptobox

Every Phase 1+ batch that stores sensitive data — applicant passport scans, EC evidence, Postgres backups, HESA-return PDFs — needs a single, well-audited "encrypt this bytes for that context" call. Without one, every domain reinvents AES-GCM (and gets it subtly wrong) or stores plaintext blobs in MinIO.

The cryptobox primitive establishes that one call. Pattern:

- **DEK (data encryption key)** — fresh 256-bit random key per message. Encrypts the payload with AES-256-GCM.
- **KEK (key encryption key)** — long-lived 256-bit master key, held outside the application (env var → KMS at deploy time). Encrypts the DEK with AES-256-GCM (separate IV).

The on-disk envelope:

```
version(1) | kek_iv(12) | kek_tag(16) | wrapped_dek(32) |
dek_iv(12) | dek_tag(16) | aad_len(2) | aad | ciphertext
```

Why envelope rather than KEK-encrypt-payload directly:

1. **KMS rate limits.** A million-row backfill that called KEK-encrypt per row would melt. Envelope means one KEK-encrypt per record regardless of payload size.
2. **Key rotation.** Rotating the KEK requires re-wrapping every DEK (cheap — 32 bytes per record), not re-encrypting every payload (expensive — could be MBs).
3. **Crypto agility.** The version byte lets the envelope evolve (AES-GCM-SIV, XChaCha20-Poly1305) without a schema migration.
4. **AAD binding.** Authenticated-additional-data — typically `${bucket}/${object_key}` — is bound into both the payload and the wrapped-DEK auth tags. An attacker can't transplant a wrapped DEK across envelopes.

Implementation: `server/src/utils/cryptobox.ts`. Pure Node `crypto`, no new deps. Surface area:

- `encrypt({plaintext, aad}) -> Buffer` — pack an envelope.
- `decrypt({envelope, aad}) -> Buffer` — unpack with auth-tag verification.
- `encryptString` / `decryptString` — base64 string convenience wrappers.
- `generateKek()` — operator helper to produce a fresh KEK as base64.

## 2. Operator decisions (deferred to deploy-time)

The cryptobox library is provider-agnostic. Operators pick three things at deployment:

| Decision | Options | Recommendation |
|---|---|---|
| KEK source | env var, AWS KMS, GCP Cloud KMS, HashiCorp Vault | Start with env var via Vercel/Railway secret store; migrate to KMS in Phase 11+ when multi-tenant adds tenant-scoped keys. |
| Key rotation cadence | Annual, every 90 days, never | Annual matches FCA / GDPR guidance. Rotation is cheap because only the wrapped-DEK changes per record. v2 envelope (a follow-on) supports multi-KEK with key id; v1 is single-KEK. |
| AAD policy | `${bucket}/${key}`, `${tenantId}/${entityId}`, anything | `${bucket}/${object_key}` for MinIO uploads; `${entityType}/${entityId}` for column-level encryption. Document the chosen policy per call site so future operators can audit. |

These are operator-driven for the deployment; the code is unopinionated.

## 3. MinIO 4-bucket layout

The `sjms5-*` namespace, provisioned by `scripts/provision-minio-buckets.sh`:

| Bucket | Use | ACL | Encrypted? | Lifecycle |
|---|---|---|---|---|
| `sjms5-uploads-public` | Applicant/student-uploaded artefacts that may be served via presigned URL (CVs, photos) | Download-anonymous | No (public by definition) | Per-object presigned URLs handle access |
| `sjms5-uploads-private` | Sensitive uploads (passport scans, medical attestation, EC evidence) | Bucket-private | **Yes** — cryptobox round-trip per object | No auto-expire (legal hold) |
| `sjms5-backups` | Postgres dumps + n8n workflow exports | Bucket-private | **Yes** | Versioning on; non-current expire 30 days; current expire 365 days |
| `sjms5-evidence` | Audit / compliance / phase-evidence artefacts (HESA returns, ULN audit trails, k6 reports) | Bucket-private | **Yes** | Versioning on; legal-hold |

The provisioning script is idempotent — re-running against an already-set-up MinIO does nothing. Hand-runs the operator does at first boot of each environment.

## 4. What 0C does NOT do (sequenced as follow-ons)

- **The MinIO client wrapper.** A small `server/src/utils/minio.ts` that wraps `put`/`get`/`presign` and routes private-bucket writes through the cryptobox — sequenced to **Phase 21** portal-completion (the first business-code consumer of MinIO is the applicant document-upload page).
- **Backfill of existing plaintext blobs.** There are zero plaintext blobs in production today (the MinIO container is empty); when blobs start landing in Phase 1+, the cryptobox is the single entry point. No backfill needed.
- **Multi-KEK rotation.** v1 envelope (`version = 0x01`) is single-KEK. v2 will introduce a `key_id` field so two KEKs can coexist during a rotation window. Sequenced to **KI-S5-304-2** when the operator schedules the first annual rotation.
- **KMS integration.** The cryptobox reads `CRYPTO_KEK_BASE64` from env. At Phase 11 multi-tenancy, a `kek-source` adapter will let the env-var source be swapped for AWS KMS / GCP KMS / Vault Decrypt without changing the cryptobox surface. The interface is intentionally small (`getKek(): Buffer`) so the adapter swap is one file.
- **Column-level encryption in Prisma.** When Phase 2 multi-tenancy adds tenant-scoped encryption, a Prisma middleware will route specific column reads/writes through the cryptobox. Sequenced to **KI-S5-304-3**.

## 5. Verification

```
$ pnpm exec vitest run src/__tests__/unit/cryptobox.test.ts
✓ src/__tests__/unit/cryptobox.test.ts (15 tests)

Test Files  1 passed (1)
     Tests  15 passed (15)
```

Test coverage:

- Round-trip string + binary buffer.
- AAD-mismatch decryption refused.
- Tampered ciphertext refused (auth-tag verification).
- Tampered wrapped-DEK refused.
- Unsupported envelope version refused.
- Truncated envelope refused.
- Missing / wrong-size KEK refused with a clear error.
- Probabilistic IV — two encrypts of the same payload produce different ciphertexts.
- `generateKek` returns 32 decoded bytes.
- AAD up to 65535 bytes accepted; 65536+ rejected.
- 1 MB payload round-trips correctly.
- Empty-AAD edge case (allowed if both sides match; rejected if one side empties it).

## 6. Operator-actions list

- [ ] At deployment: `openssl rand -base64 32 | base64 -w0` to mint a KEK; store in Vercel / Railway / Vault secrets.
- [ ] Set `CRYPTO_KEK_BASE64` in the deployment env (never commit to git).
- [ ] Run `scripts/provision-minio-buckets.sh` against each environment's MinIO to create the 4-bucket layout.
- [ ] Record the chosen AAD policy per upcoming call site in this evidence file's §2 table.

## 7. Acceptance signal

Closes batch 0C per the Phase 0 build queue. Closes KI-S5-304. The cryptobox primitive + MinIO bucket layout are ready for Phase 1+ business code to consume.
