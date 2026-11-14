// Offline support: load the app from the network when possible, and from the cache when not.
// Bump CACHE on every release (keep it in step with APP_VERSION in config.js), so every
// phone picks up the new files.
const CACHE = 'hive-v1.2.0';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'content.js',
  'dispatch.js',
  'drive.js',
  'icons.js',
  'install.js',
  'routines.js',
  'store.js',
  'time.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  // 'reload' asks the network for fresh copies, so a new version never installs old files.
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(APP_FILES.map(file => cache.add(new Request(file, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  // Only the app's own files are handled here. Google sign-in and Drive calls are never cached.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 'no-cache' checks with the server every time, so updates show up the next time the app opens.
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
      return Response.error();
    }
  })());
});
