/* Minimal service worker for offline app shell caching */
const VERSION = 'v1-' + (self.crypto?.randomUUID?.() || Date.now());
const CACHE_NAME = `backroads-cache-${VERSION}`;

// Use relative paths so it works under Vite base (e.g., /BackroadsApp/)
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // For navigation requests, try network first, then fall back to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put('index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match('index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // For same-origin static requests, use cache-first and update in background
  if (sameOrigin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        const fetchAndCache = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              cache.put(request, resp.clone());
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fetchAndCache;
      })()
    );
  }
});

