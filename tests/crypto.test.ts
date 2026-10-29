/**
 * Crypto layer tests — identity, PIN hashing and sealed payloads.
 * Everything runs against the real WebCrypto, not a stub.
 */

import { describe, it, expect } from 'vitest';
import {
  b64url,
  fromB64url,
  uuid,
  randomId,
  sha256Hex,
  hmacHex,
  safeEqual,
  hashPin,
  makeSalt,
  sealText,
  openText,
} from '../src/lib/crypto';

describe('identifiers', () => {
  it('generates RFC-4122 v4 uuids', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(seen.size).toBe(500);
  });

  it('produces url-safe random ids of the requested entropy', () => {
    const id = randomId(16);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.length).toBeGreaterThanOrEqual(21);
    expect(new Set(Array.from({ length: 300 }, () => randomId(8))).size).toBe(300);
  });

  it('round-trips base64url, including the characters that differ from base64', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const encoded = b64url(bytes);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect([...fromB64url(encoded)]).toEqual([...bytes]);
  });
});

describe('hashing', () => {
  it('matches the published SHA-256 vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the published HMAC-SHA256 vector', async () => {
    expect(await hmacHex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('PIN hashing', () => {
  it('is deterministic for the same pin and salt', async () => {
    const salt = makeSalt();
    expect(await hashPin('1234', salt)).toBe(await hashPin('1234', salt));
  });

  it('produces a different hash per salt, so identical PINs are not recognisable', async () => {
    const a = await hashPin('1234', makeSalt());
    const b = await hashPin('1234', makeSalt());
    expect(a).not.toBe(b);
  });

  it('rejects a wrong pin', async () => {
    const salt = makeSalt();
    const stored = await hashPin('1234', salt);
    expect(await hashPin('1235', salt)).not.toBe(stored);
    expect(await hashPin('12345', salt)).not.toBe(stored);
  });

  it('never stores the pin itself', async () => {
    const salt = makeSalt();
    const hash = await hashPin('987654', salt);
    expect(hash).not.toContain('987654');
    expect(hash.length).toBeGreaterThanOrEqual(43);
  });

  it('generates unique salts', () => {
    expect(new Set(Array.from({ length: 200 }, makeSalt)).size).toBe(200);
  });
});

describe('sealed payloads', () => {
  it('round-trips text', async () => {
    const sealed = await sealText('the answer is 42', 'passphrase');
    expect(sealed).toMatch(/^S1\./);
    expect(sealed).not.toContain('the answer is 42');
    expect(await openText(sealed, 'passphrase')).toBe('the answer is 42');
  });

  it('handles unicode', async () => {
    const text = 'راز — 秘密 — 🔐';
    expect(await openText(await sealText(text, 'p'), 'p')).toBe(text);
  });

  it('never leaks plaintext into the ciphertext', async () => {
    const sealed = await sealText('SECRET-QUESTION', 'k');
    expect(sealed).not.toContain('SECRET');
  });

  it('fails with the wrong passphrase', async () => {
    const sealed = await sealText('hello', 'right');
    await expect(openText(sealed, 'wrong')).rejects.toThrow();
  });

  it('fails when the ciphertext is tampered with', async () => {
    const sealed = await sealText('hello', 'k');
    const [version, iv, body] = sealed.split('.');
    const flipped = body.slice(0, -2) + (body.slice(-2) === 'AA' ? 'BB' : 'AA');
    await expect(openText(`${version}.${iv}.${flipped}`, 'k')).rejects.toThrow();
  });

  it('uses a fresh IV each time, so identical text encrypts differently', async () => {
    const a = await sealText('same', 'k');
    const b = await sealText('same', 'k');
    expect(a).not.toBe(b);
  });

  it('rejects a malformed payload', async () => {
    await expect(openText('not-sealed', 'k')).rejects.toThrow(/sealed/i);
  });
});
