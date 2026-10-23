// Service worker: a script the browser runs in the background for this site.
// It keeps a copy of the app files so the app opens with no internet.
// Strategy: answer from the cache right away, then fetch a fresh copy in the
// background, so a new deploy shows up on the next open.
// Only the app's own files are handled. Sync requests to Supabase go straight
// to the network, so the app never sees stale notes from the cache.

const CACHE = 'quick-notes-v4';
const FILES = [
  './',
  'index.html',
  'style.css',
  'data.js',
  'views.js',
  'gestures.js',
  'home.js',
  'search.js',
  'editor.js',
  'entries.js',
  'export.js',
  'sync.js',
  'login.js',
  'main.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      e.waitUntil(network);
      return cached || network;
    })
  );
});
