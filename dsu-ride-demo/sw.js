// Offline support. Every same-origin request is network-first (so a new deploy shows up as soon as
// you're online) and falls back to the cache when offline. Map tiles are cross-origin and are left
// to the browser's own HTTP cache, per the OpenStreetMap tile usage policy.
// tests/sw.test.mjs checks that SHELL lists every app file; bump CACHE when the list changes.
const CACHE = 'dsu-ride-v6';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/actions.js',
  'js/data.js',
  'js/geo.js',
  'js/html.js',
  'js/location.js',
  'js/main.js',
  'js/map.js',
  'js/qr.js',
  'js/routing.js',
  'js/selectors.js',
  'js/state.js',
  'js/views.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return (await caches.match('index.html')) ?? Response.error();
        return Response.error();
      }),
  );
});
