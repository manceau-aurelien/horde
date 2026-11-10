const CACHE_NAME = 'horde-v6';
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './save-guard.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/data.js',
  './js/audio.js',
  './js/sprites.js',
  './js/world.js',
  './js/engine.js',
  './js/sim.js',
  './js/render.js',
  './js/net.js',
  './js/game.js',
  './js/ui.js',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Réseau d'abord pour profiter des mises à jour, cache si hors ligne. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
