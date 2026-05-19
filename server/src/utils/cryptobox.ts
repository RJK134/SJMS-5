/**
 * Cryptobox — AES-256-GCM envelope encryption (batch 0C).
 *
 * Pattern:
 *
 *   - **DEK (data encryption key)** — a fresh 256-bit random key generated
 *     per-message. The DEK encrypts the actual payload with AES-256-GCM.
 *   - **KEK (key encryption key)** — a long-lived 256-bit master key,
 *     held outside the application (env var, KMS, Vault). The KEK
 *     encrypts the DEK using AES-256-GCM with a separate IV.
 *
 * The on-disk / on-wire ciphertext is a packed envelope:
 *
 *     version(1) | kek_iv(12) | kek_tag(16) | wrapped_dek(32) |
 *     dek_iv(12) | dek_tag(16) | aad_len(2) | aad | ciphertext
 *
 * Why envelope rather than direct KEK-encrypt-payload:
 *
 *   1. KMS / Vault APIs typically rate-limit. A million-row backfill that
 *      called KEK-encrypt per row would melt. Envelope means one call to
 *      KEK per record (to wrap the DEK), independent of payload size.
 *   2. Key rotation. Rotating the KEK requires re-wrapping every DEK
 *      (cheap — 32 bytes per record), not re-encrypting every payload
 *      (expensive — could be MBs per record).
 *   3. Crypto agility. The version byte lets us evolve the envelope
 *      (AES-GCM-SIV, XChaCha20-Poly1305) without a schema migration.
 *
 * Operator decisions deferred to deploy-time:
 *
 *   - **KEK source.** This module reads CRYPTO_KEK_BASE64 from env. In
 *     production, the env var is populated by an out-of-band secrets
 *     manager (Vercel env, AWS KMS Decrypt at boot, HashiCorp Vault
 *     KV-v2). The KEK never lives in git.
 *   - **Key rotation cadence.** Standard guidance is annual; this module
 *     supports multi-KEK via a key id in the envelope (a future v2).
 *     v1 supports a single KEK.
 *   - **AAD policy.** Authenticated-additional-data is opaque to the
 *     library; call sites pass the bucket name + object key (or row id)
 *     so a ciphertext blob cannot be replayed under a different "context".
 */

import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const VERSION = 0x01;
const KEK_IV_LEN = 12;
const KEK_TAG_LEN = 16;
const DEK_LEN = 32;
const DEK_IV_LEN = 12;
const DEK_TAG_LEN = 16;
const ALG = 'aes-256-gcm';

const HEADER_LEN = 1 + KEK_IV_LEN + KEK_TAG_LEN + DEK_LEN + DEK_IV_LEN + DEK_TAG_LEN + 2;

function getKek(): Buffer {
  const raw = process.env.CRYPTO_KEK_BASE64?.trim();
  if (!raw) {
    throw new Error(
      'CRYPTO_KEK_BASE64 is not set. The cryptobox cannot operate without a 32-byte key encryption key. Generate one with `openssl rand -base64 32` and set it in your deployment env.',
    );
  }
  const kek = Buffer.from(raw, 'base64');
  if (kek.length !== DEK_LEN) {
    throw new Error(
      `CRYPTO_KEK_BASE64 must decode to exactly 32 bytes (got ${kek.length}). The KEK is a 256-bit key.`,
    );
  }
  return kek;
}

export interface CryptoboxEncryptInput {
  /** The payload to encrypt. */
  plaintext: Buffer | string;
  /** Authenticated-additional-data bound to this ciphertext. Often `${bucket}/${key}`. */
  aad: string;
}

/**
 * Encrypt a payload under the KEK + a fresh DEK. Returns the packed
 * envelope bytes — safe to store in MinIO / Postgres / on-disk.
 */
export function encrypt(input: CryptoboxEncryptInput): Buffer {
  const kek = getKek();
  const aadBuf = Buffer.from(input.aad, 'utf8');
  if (aadBuf.length > 65_535) {
    throw new Error('AAD exceeds 65535 bytes — pick a shorter context string.');
  }
  const plaintext =
    typeof input.plaintext === 'string' ? Buffer.from(input.plaintext, 'utf8') : input.plaintext;

  // 1. Generate fresh DEK.
  const dek = randomBytes(DEK_LEN);

  // 2. Encrypt the payload with the DEK.
  const dekIv = randomBytes(DEK_IV_LEN);
  const dekCipher = createCipheriv(ALG, dek, dekIv);
  dekCipher.setAAD(aadBuf);
  const ciphertext = Buffer.concat([dekCipher.update(plaintext), dekCipher.final()]);
  const dekTag = dekCipher.getAuthTag();

  // 3. Wrap the DEK with the KEK.
  const kekIv = randomBytes(KEK_IV_LEN);
  const kekCipher = createCipheriv(ALG, kek, kekIv);
  // The wrapped-DEK is also AAD-bound, so an attacker can't transplant a
  // wrapped DEK from one envelope to another.
  kekCipher.setAAD(aadBuf);
  const wrappedDek = Buffer.concat([kekCipher.update(dek), kekCipher.final()]);
  const kekTag = kekCipher.getAuthTag();

  // 4. Pack the envelope.
  const aadLenBuf = Buffer.alloc(2);
  aadLenBuf.writeUInt16BE(aadBuf.length, 0);

  return Buffer.concat([
    Buffer.from([VERSION]),
    kekIv,
    kekTag,
    wrappedDek,
    dekIv,
    dekTag,
    aadLenBuf,
    aadBuf,
    ciphertext,
  ]);
}

export interface CryptoboxDecryptInput {
  /** The packed envelope bytes. */
  envelope: Buffer;
  /** The AAD that was supplied at encrypt time. Must match exactly. */
  aad: string;
}

/**
 * Decrypt a packed envelope. Throws if the version is unknown, the
 * envelope is too short, or the auth tag doesn't verify.
 */
export function decrypt(input: CryptoboxDecryptInput): Buffer {
  const kek = getKek();
  const env = input.envelope;
  if (env.length < HEADER_LEN) {
    throw new Error(`Envelope too short: ${env.length} bytes (header alone is ${HEADER_LEN}).`);
  }
  if (env[0] !== VERSION) {
    throw new Error(`Unsupported cryptobox envelope version: 0x${env[0].toString(16)}`);
  }

  let off = 1;
  const kekIv = env.subarray(off, off + KEK_IV_LEN);
  off += KEK_IV_LEN;
  const kekTag = env.subarray(off, off + KEK_TAG_LEN);
  off += KEK_TAG_LEN;
  const wrappedDek = env.subarray(off, off + DEK_LEN);
  off += DEK_LEN;
  const dekIv = env.subarray(off, off + DEK_IV_LEN);
  off += DEK_IV_LEN;
  const dekTag = env.subarray(off, off + DEK_TAG_LEN);
  off += DEK_TAG_LEN;
  const aadLen = env.readUInt16BE(off);
  off += 2;
  const envAad = env.subarray(off, off + aadLen);
  off += aadLen;
  const ciphertext = env.subarray(off);

  // Constant-time AAD check before any crypto work — protects against
  // timing oracles that distinguish "wrong AAD" from "tampered ciphertext".
  const callerAad = Buffer.from(input.aad, 'utf8');
  if (envAad.length !== callerAad.length || !timingSafeEqual(envAad, callerAad)) {
    throw new Error('Cryptobox AAD mismatch — ciphertext not valid in this context.');
  }

  // Unwrap the DEK.
  const kekDecipher = createDecipheriv(ALG, kek, kekIv);
  kekDecipher.setAAD(callerAad);
  kekDecipher.setAuthTag(kekTag);
  const dek = Buffer.concat([kekDecipher.update(wrappedDek), kekDecipher.final()]);

  // Decrypt the payload.
  const dekDecipher = createDecipheriv(ALG, dek, dekIv);
  dekDecipher.setAAD(callerAad);
  dekDecipher.setAuthTag(dekTag);
  return Buffer.concat([dekDecipher.update(ciphertext), dekDecipher.final()]);
}

/** Convenience — encrypt a UTF-8 string and return base64. */
export function encryptString(plaintext: string, aad: string): string {
  return encrypt({ plaintext, aad }).toString('base64');
}

/** Convenience — decrypt a base64 envelope back to a UTF-8 string. */
export function decryptString(envelopeBase64: string, aad: string): string {
  return decrypt({ envelope: Buffer.from(envelopeBase64, 'base64'), aad }).toString('utf8');
}

/**
 * Operator helper — generate a fresh KEK as base64. Use for one-off
 * provisioning, then store the output in your secrets manager and set
 * `CRYPTO_KEK_BASE64` in the deployment env.
 *
 * Equivalent to `openssl rand -base64 32`.
 */
export function generateKek(): string {
  return randomBytes(DEK_LEN).toString('base64');
}
