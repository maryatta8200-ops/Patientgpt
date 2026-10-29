/** Service worker registration + update signalling. */

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
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
