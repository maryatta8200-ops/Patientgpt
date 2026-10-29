/**
 * Service worker execution tests.
 *
 * `public/sw.js` is plain JavaScript that runs in a worker global scope, so it
 * is loaded into a VM context with a fake `self`, `caches` and `fetch`. This is
 * the only way to prove the scope-relative path logic works at both a domain
 * root and a GitHub Pages subpath without a browser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8');

interface Harness {
  cachedUrls: string[];
  cachePuts: string[];
  deletedCaches: string[];
  fetchCalls: string[];
  handlers: Record<string, (event: unknown) => void>;
  /** Invokes the install handler and resolves when its work settles. */
  install: () => Promise<void>;
}

function loadSw(scope: string, options: { failNetwork?: boolean; cachedShell?: boolean } = {}): Harness {
  const cachedUrls: string[] = [];
  const cachePuts: string[] = [];
  const deletedCaches: string[] = [];
  const fetchCalls: string[] = [];
  const handlers: Record<string, (event: unknown) => void> = {};

  class FakeRequest {
    url: string;
    constructor(url: string) {
      // Mirrors the platform: relative paths resolve against the worker's URL.
      this.url = new URL(url, scope).href;
    }
  }

  const cache = {
    addAll: async (requests: FakeRequest[]) => {
      cachedUrls.push(...requests.map((r) => r.url));
    },
    put: async (key: string | FakeRequest) => {
      cachePuts.push(typeof key === 'string' ? key : key.url);
    },
    match: async () => undefined,
  };

  const cachesStub = {
    open: async () => cache,
    keys: async () => ['pulse-v0.9.0-shell', 'other-app'],
    delete: async (key: string) => {
      deletedCaches.push(key);
      return true;
    },
    match: async (key: string) => (options.cachedShell ? { cached: new URL(key, scope).href } : undefined),
  };

  const self = {
    registration: { scope },
    location: { href: scope, origin: new URL(scope).origin },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
  };

  const sandbox = {
    self,
    caches: cachesStub,
    Request: FakeRequest,
    Response: class {
      body: string;
      constructor(body: string) {
        this.body = body;
      }
    },
    fetch: async (request: { url?: string } | string) => {
      fetchCalls.push(typeof request === 'string' ? request : (request.url ?? ''));
      if (options.failNetwork) throw new TypeError('Failed to fetch');
      return { clone: () => ({ ok: true }), ok: true };
    },
    URL,
    console,
    Promise,
    Set,
  };

  vm.runInNewContext(source, sandbox, { filename: 'sw.js' });

  return {
    cachedUrls,
    cachePuts,
    deletedCaches,
    fetchCalls,
    handlers,
    install: async () => {
      let pending: Promise<unknown> = Promise.resolve();
      handlers.install({
        waitUntil: (p: Promise<unknown>) => {
          pending = p;
        },
      });
      await pending;
    },
  };
}

describe('root deploy (base "/")', () => {
  it('pre-caches the shell at the domain root', async () => {
    const harness = loadSw('https://pulse.example/');
    await harness.install();

    expect(harness.cachedUrls).toContain('https://pulse.example/index.html');
    expect(harness.cachedUrls).toContain('https://pulse.example/icons/icon-512.png');
    expect(harness.cachedUrls).toContain('https://pulse.example/manifest.webmanifest');
    expect(harness.cachedUrls).toContain('https://pulse.example/');
  });
});

describe('subpath deploy (GitHub Pages, base "/Patientgpt/")', () => {
  it('pre-caches every asset under the project path', async () => {
    const harness = loadSw('https://owner.github.io/Patientgpt/');
    await harness.install();

    expect(harness.cachedUrls).toContain('https://owner.github.io/Patientgpt/index.html');
    expect(harness.cachedUrls).toContain('https://owner.github.io/Patientgpt/icons/icon-192.png');

    // Nothing may leak to the domain root, which belongs to a different app.
    for (const url of harness.cachedUrls) {
      expect(url).toContain('/Patientgpt/');
    }
  });

  it('still resolves to the project path when the origin serves other sites', async () => {
    const harness = loadSw('https://owner.github.io/other-repo/');
    await harness.install();
    expect(harness.cachedUrls.every((u) => u.startsWith('https://owner.github.io/other-repo/'))).toBe(
      true,
    );
  });
});

describe('caching rules', () => {
  it('removes caches from earlier versions but leaves other apps alone', async () => {
    const harness = loadSw('https://pulse.example/');
    harness.handlers.activate({
      waitUntil: (p: Promise<unknown>) => p,
    });
    // Let the activation chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.deletedCaches).toContain('pulse-v0.9.0-shell');
    expect(harness.deletedCaches).not.toContain('other-app');
  });

  it('ignores non-GET requests entirely', () => {
    const harness = loadSw('https://pulse.example/');
    let responded = false;
    harness.handlers.fetch({
      request: { method: 'POST', url: 'https://pulse.example/api' },
      respondWith: () => {
        responded = true;
      },
    });
    expect(responded).toBe(false);
  });

  it('lets relay traffic go straight to the network', () => {
    const harness = loadSw('https://pulse.example/');
    let responded = false;

    for (const url of [
      'https://script.google.com/macros/s/AK/exec',
      'https://script.googleusercontent.com/macros/echo',
    ]) {
      harness.handlers.fetch({
        request: { method: 'GET', url, mode: 'cors' },
        respondWith: () => {
          responded = true;
        },
      });
    }

    // Questions and answers must never enter the HTTP cache.
    expect(responded).toBe(false);
  });

  it('serves the cached shell for a navigation when the network fails', async () => {
    const harness = loadSw('https://owner.github.io/Patientgpt/', {
      failNetwork: true,
      cachedShell: true,
    });

    let responsePromise: Promise<unknown> | undefined;
    harness.handlers.fetch({
      request: { method: 'GET', url: 'https://owner.github.io/Patientgpt/', mode: 'navigate' },
      respondWith: (p: Promise<unknown>) => {
        responsePromise = p;
      },
    });

    expect(responsePromise).toBeDefined();
    const response = await responsePromise;
    expect(response).toEqual({ cached: 'https://owner.github.io/Patientgpt/index.html' });
  });

  it('returns an offline notice when even the shell is missing', async () => {
    const harness = loadSw('https://owner.github.io/Patientgpt/', { failNetwork: true });

    let responsePromise: Promise<unknown> | undefined;
    harness.handlers.fetch({
      request: { method: 'GET', url: 'https://owner.github.io/Patientgpt/', mode: 'navigate' },
      respondWith: (p: Promise<unknown>) => {
        responsePromise = p;
      },
    });

    const response = (await responsePromise) as { body?: string };
    expect(String(response.body ?? response)).toMatch(/offline/i);
  });

  it('does not intercept asset requests belonging to another origin', () => {
    const harness = loadSw('https://owner.github.io/Patientgpt/');
    let responded = false;
    harness.handlers.fetch({
      request: { method: 'GET', url: 'https://fonts.example/x.woff2', mode: 'cors' },
      respondWith: () => {
        responded = true;
      },
    });
    expect(responded).toBe(false);
  });
});
