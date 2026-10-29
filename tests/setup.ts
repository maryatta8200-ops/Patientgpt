/**
 * Test environment bootstrap.
 *
 * - `fake-indexeddb/auto` gives the Node tests a real IndexedDB implementation,
 *   so the local-first data layer is exercised against actual transactions.
 * - Node 22 exposes WebCrypto globally; fail loudly if that ever changes, since
 *   identity, PIN hashing and sealing all depend on it.
 */

import 'fake-indexeddb/auto';

if (!globalThis.crypto?.subtle) {
  throw new Error('WebCrypto is unavailable — the crypto tests cannot run');
}

// Some environments ship btoa/atob only on the window object.
if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (input: string) => Buffer.from(input, 'binary').toString('base64');
  globalThis.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
}

/**
 * jsdom omits matchMedia, which the install banner uses to detect standalone
 * display mode. Every real browser has it, so stub the standard surface.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/* jsdom does not implement element scrolling. */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo() {
    /* no-op in tests */
  } as typeof Element.prototype.scrollTo;
}
