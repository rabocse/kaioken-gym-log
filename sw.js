// Kaioken service worker.
//
// Strategy: stale-while-revalidate. A launch serves the cached shell
// instantly (the gym has no signal, and iOS kills standalone apps
// aggressively, so cold starts are frequent); the copy is refreshed in the
// background and the next launch gets the fresh bytes. Only a first-ever
// visit waits on the network.
//
// The cache name comes from VERSION below, never from another file fetched
// over the network: a fetch of the manifest could read it out of the HTTP
// cache (GitHub Pages serves max-age=600) and name the new cache after the
// old release. A release therefore bumps the version in three places,
// together: VERSION here, APP_VERSION (js/app.js) and the version in
// manifest.webmanifest. `npm run verify` fails if they drift apart.

const VERSION = '1.13.0';
const CACHE = 'kaioken-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/catalog.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache. GitHub Pages serves
      // max-age=600, so a deploy inside that window would otherwise
      // precache the previous release's bytes into the new cache.
      .then((c) => Promise.all(ASSETS.map((url) => c.add(new Request(url, { cache: 'reload' })))))
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
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin requests are not ours to cache: let the network handle them.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Always answer navigations (and their ?_= cache-busting tokens) with
    // the shell under one key, so the cache cannot grow per token.
    e.respondWith(
      caches.match('./index.html').then((cached) => {
        const refresh = fetch(new Request(req.url, { cache: 'no-cache' })).then((res) => {
          if (res.ok) {
            e.waitUntil(caches.open(CACHE).then((c) => c.put('./index.html', res.clone())));
          }
          return res;
        });
        if (!cached) return refresh.catch(() => Response.error());
        e.waitUntil(refresh.catch(() => {}));
        return cached;
      })
    );
    return;
  }

  // Query strings are never cached or matched: the app uses none today, and
  // full-URL keys would otherwise grow the cache without bound.
  if (url.search) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Refresh behind the returned copy. no-cache skips the HTTP cache,
        // or the "fresh" copy could be the same stale one for up to 10 min.
        e.waitUntil(
          fetch(new Request(req.url, { cache: 'no-cache' }))
            .then((res) => {
              if (res.ok) return caches.open(CACHE).then((c) => c.put(req, res));
            })
            .catch(() => {})
        );
        return cached;
      }
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            // Chained into waitUntil, or the worker can be terminated once
            // the response resolves and the cache write is lost.
            e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => Response.error());
    })
  );
});
