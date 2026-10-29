// Service worker: keeps the app itself available offline (the archive lives in IndexedDB, not here).
//
// Strategy: network first, cache as the fallback. Online you always get the current files; offline,
// or with the network failing, the last good copy is served. Requests to the device (a different
// origin) are never touched.
//
// Bump VERSION with APP_VERSION in js/version.js on every release, and keep SHELL in step with the
// files in this folder (tests/unit/precache.test.mjs checks that).

const VERSION = '0.1.0';
const CACHE = `statchain-app-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/api.js',
  'js/chart-math.js',
  'js/charts.js',
  'js/export.js',
  'js/format.js',
  'js/logs.js',
  'js/main.js',
  'js/metrics.js',
  'js/prefs.js',
  'js/session.js',
  'js/store.js',
  'js/sync.js',
  'js/tz.js',
  'js/ui.js',
  'js/version.js',
  'js/views/chart-card.js',
  'js/views/export.js',
  'js/views/home.js',
  'js/views/settings.js',
  'js/views/today.js',
  'js/views/trends.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('statchain-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // the device, or anything else: not ours

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      // Offline. Any page navigation gets the app shell; assets come from the cache.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
