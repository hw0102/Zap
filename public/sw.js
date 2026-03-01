const CACHE_VERSION = 'zap-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/qr.js',
  '/signaling.js',
  '/webrtc.js',
  '/transfer.js',
  '/hotspot.js',
  '/app.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Install: pre-cache all static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-first for others
self.addEventListener('fetch', (e) => {
  // Skip non-GET and WebSocket upgrade requests
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) {
        // Return cache, but also update in background
        fetch(e.request).then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(e.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
