/**
 * Pulse service worker.
 *
 * Strategy
 *   • App shell (navigation): network-first with a cached shell fallback, so a
 *     deploy is picked up but a cold offline launch still works.
 *   • Static assets: stale-while-revalidate, cached forever by hash.
 *   • Relay calls (script.google.com): never cached, never intercepted beyond
 *     passing through — questions and answers must not land in the HTTP cache.
 */

const VERSION = 'pulse-v1.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('pulse-') && !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'pulse:skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache relay traffic — that is the whole point.
  if (
    url.hostname.endsWith('google.com') ||
    url.hostname.endsWith('googleusercontent.com') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return (
            cached ||
            new Response('<h1>Pulse is offline</h1><p>Reconnect once to re-cache the app.</p>', {
              headers: { 'Content-Type': 'text/html' },
              status: 200,
            })
          );
        }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
