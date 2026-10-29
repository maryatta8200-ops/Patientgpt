/**
 * Crypto helpers built on WebCrypto only — no dependencies, no network.
 *
 *  - Identity ids: CSPRNG bytes, base64url.
 *  - PIN lock: PBKDF2-SHA256 (210k iterations) with a per-device salt.
 *  - Sealed fields: AES-GCM (reserved for optional sealed relay mode).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array<ArrayBufferLike>): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(new ArrayBuffer(bytes));
  crypto.getRandomValues(buf);
  return b64url(buf);
}

/** RFC-4122 v4 UUID (used for the public device id). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish string compare (avoids trivial timing oracles). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PBKDF2_ROUNDS = 210_000;

export async function hashPin(pin: string, salt: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64url(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    256,
  );
  return b64url(new Uint8Array(bits));
}

export function makeSalt(): string {
  const b = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(b);
  return b64url(b);
}

/** AES-GCM sealed payload, used by the optional sealed relay mode. */
export async function sealText(plain: string, passphrase: string): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const key = await deriveAesKey(passphrase, iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `S1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function openText(sealed: string, passphrase: string): Promise<string> {
  const [version, ivPart, ctPart] = sealed.split('.');
  if (version !== 'S1' || !ivPart || !ctPart) throw new Error('Not a sealed payload');
  const iv = fromB64url(ivPart);
  const key = await deriveAesKey(passphrase, iv);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromB64url(ctPart),
  );
  return dec.decode(plain);
}

async function deriveAesKey(passphrase: string, iv: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: concat(enc.encode('pulse.sealed.v1'), iv),
      iterations: 120_000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length));
  out.set(a);
  out.set(b, a.length);
  return out;
}
