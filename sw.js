// Kaioken service worker.
//
// Strategy: network-first. When online you always get the latest files
// (code updates appear on the next reload); the cache is only used as an
// offline fallback. The precache on install makes the app usable offline
// from the first visit.
//
// The cache name is derived from the manifest's version on install, so the
// cache and the app version can never drift apart: bumping the version in
// manifest.webmanifest is the only change a release needs.

let CACHE = 'kaioken';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './img/background.jpg',
  './js/catalog.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('./manifest.webmanifest')
      .then((res) => {
        if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
        return res.json();
      })
      .then((m) => {
        if (!m || !m.version) throw new Error('manifest version missing');
        CACHE = 'kaioken-' + m.version;
        return caches.open(CACHE);
      })
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const url = new URL(e.request.url);
        if (res.ok && url.origin === self.location.origin) {
          // Refresh the cache in the background for offline use. The copy
          // is chained into waitUntil, or the worker can be terminated
          // once the response resolves and the cache write is lost.
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
