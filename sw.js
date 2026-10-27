// Service worker: a script the browser runs in the background for this site.
// It keeps a copy of the app files so the app opens with no internet.
// Strategy: answer from the cache right away, then fetch a fresh copy in the
// background, so a new deploy shows up on the next open. When that fresh copy
// differs from the cached one, the open pages are told so they can reload.
// Only the app's own files are handled. Sync requests to Supabase go straight
// to the network, so the app never sees stale notes from the cache.

const CACHE = 'quick-notes-v15';
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
  'autofile.js',
  'entries.js',
  'transfer.js',
  'schedule.js',
  'export.js',
  'sync.js',
  'login.js',
  'help.js',
  'keys.js',
  'main.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'fonts/literata.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(async (keys) => {
      const old = keys.filter((k) => k !== CACHE);
      await Promise.all(old.map((k) => caches.delete(k)));
      await self.clients.claim();
      // An older cache means this is an update, not a first install.
      if (old.length) await tellPages();
    })
  );
});

function tellPages() {
  return self.clients.matchAll().then((pages) => pages.forEach((p) => p.postMessage('updated')));
}

// Only text files are compared; fonts and icons don't change with a deploy.
async function changed(cached, fresh) {
  const type = fresh.headers.get('content-type') || '';
  if (!/text|javascript|json/.test(type)) return false;
  return (await cached.clone().text()) !== (await fresh.clone().text());
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then(async (res) => {
          if (res.ok) {
            if (cached && (await changed(cached, res))) await tellPages();
            cache.put(e.request, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      e.waitUntil(network);
      return cached || network;
    })
  );
});
