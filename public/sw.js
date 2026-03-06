const CACHE_NAME = 'blokus-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/game-logic.js',
  '/app.js',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Socket.io やAPIリクエストはキャッシュしない
  if (e.request.url.includes('/socket.io/')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
