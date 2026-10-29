/** Service worker registration + update signalling. */

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      // BASE_URL is "/" on a root deploy and "/repo/" on a GitHub Pages project
      // site, so the worker, its scope and its cache keys stay in step.
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event('pulse:update'));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[pulse] service worker registration failed', err);
      });
  });
}
