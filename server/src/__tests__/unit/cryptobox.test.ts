import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { encrypt, decrypt, encryptString, decryptString, generateKek } from '../../utils/cryptobox';

const ORIGINAL_KEK = process.env.CRYPTO_KEK_BASE64;
const TEST_KEK = generateKek();

describe('cryptobox', () => {
  beforeEach(() => {
    process.env.CRYPTO_KEK_BASE64 = TEST_KEK;
  });
  afterEach(() => {
    if (ORIGINAL_KEK === undefined) delete process.env.CRYPTO_KEK_BASE64;
    else process.env.CRYPTO_KEK_BASE64 = ORIGINAL_KEK;
  });

  it('round-trips a UTF-8 string', () => {
    const aad = 'sjms5/uploads/user-1.pdf';
    const cipher = encryptString('hello, world', aad);
    expect(cipher).toMatch(/^[A-Za-z0-9+/=]+$/); // base64
    expect(decryptString(cipher, aad)).toBe('hello, world');
  });

  it('round-trips a binary buffer', () => {
    const aad = 'sjms5/backups/sjms.dump';
    const payload = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const env = encrypt({ plaintext: payload, aad });
    expect(env.byteLength).toBeGreaterThan(payload.byteLength);
    expect(decrypt({ envelope: env, aad })).toEqual(payload);
  });

  it('rejects decryption when AAD differs', () => {
    const env = encrypt({ plaintext: 'secret', aad: 'context-A' });
    expect(() => decrypt({ envelope: env, aad: 'context-B' }))
      .toThrow(/AAD mismatch/);
  });

  it('rejects decryption when ciphertext is tampered', () => {
    const env = encrypt({ plaintext: 'secret', aad: 'ctx' });
    // Flip a bit in the ciphertext region (last byte of envelope).
    env[env.length - 1] ^= 0xff;
    expect(() => decrypt({ envelope: env, aad: 'ctx' }))
      .toThrow();
  });

  it('rejects decryption when wrapped DEK is tampered', () => {
    const env = encrypt({ plaintext: 'secret', aad: 'ctx' });
    // The wrapped DEK lives at byte 29 (1 + 12 + 16 = 29). Flip a bit there.
    env[29] ^= 0xff;
    expect(() => decrypt({ envelope: env, aad: 'ctx' }))
      .toThrow();
  });

  it('rejects unsupported envelope versions', () => {
    const env = encrypt({ plaintext: 'secret', aad: 'ctx' });
    env[0] = 0x02;
    expect(() => decrypt({ envelope: env, aad: 'ctx' }))
      .toThrow(/Unsupported cryptobox envelope version/);
  });

  it('rejects truncated envelopes', () => {
    const env = encrypt({ plaintext: 'secret', aad: 'ctx' });
    expect(() => decrypt({ envelope: env.subarray(0, 10), aad: 'ctx' }))
      .toThrow(/Envelope too short/);
  });

  it('throws a clear error when CRYPTO_KEK_BASE64 is unset', () => {
    delete process.env.CRYPTO_KEK_BASE64;
    expect(() => encryptString('x', 'ctx')).toThrow(/CRYPTO_KEK_BASE64 is not set/);
    expect(() => decryptString('x', 'ctx')).toThrow(/CRYPTO_KEK_BASE64 is not set/);
  });

  it('rejects a KEK that does not decode to 32 bytes', () => {
    process.env.CRYPTO_KEK_BASE64 = Buffer.alloc(16).toString('base64');
    expect(() => encryptString('x', 'ctx')).toThrow(/exactly 32 bytes/);
  });

  it('produces a different ciphertext on each encrypt (probabilistic IV)', () => {
    const c1 = encryptString('same', 'ctx');
    const c2 = encryptString('same', 'ctx');
    expect(c1).not.toBe(c2); // fresh DEK + fresh IVs => fresh envelope
    expect(decryptString(c1, 'ctx')).toBe('same');
    expect(decryptString(c2, 'ctx')).toBe('same');
  });

  it('generateKek returns a base64 string of 32 decoded bytes', () => {
    const k = generateKek();
    expect(Buffer.from(k, 'base64')).toHaveLength(32);
  });

  it('handles long AAD values (up to 65535 bytes)', () => {
    const longAad = 'x'.repeat(65535);
    const env = encrypt({ plaintext: 'secret', aad: longAad });
    expect(decrypt({ envelope: env, aad: longAad })).toEqual(Buffer.from('secret'));
  });

  it('rejects AAD over the 65535-byte limit', () => {
    const tooLong = 'x'.repeat(65536);
    expect(() => encrypt({ plaintext: 'p', aad: tooLong })).toThrow(/exceeds 65535/);
  });

  it('round-trips a 1MB payload', () => {
    const payload = Buffer.alloc(1024 * 1024).fill(0xab);
    const env = encrypt({ plaintext: payload, aad: 'big' });
    expect(decrypt({ envelope: env, aad: 'big' })).toEqual(payload);
  });

  it('throws on empty AAD when stored ciphertext is verified against a different empty AAD', () => {
    // Empty AAD round-trips fine when intentional.
    const env = encrypt({ plaintext: 'p', aad: '' });
    expect(decrypt({ envelope: env, aad: '' }).toString()).toBe('p');
    // But replaying with a non-empty AAD must fail.
    expect(() => decrypt({ envelope: env, aad: 'something' })).toThrow(/AAD mismatch/);
  });
});
