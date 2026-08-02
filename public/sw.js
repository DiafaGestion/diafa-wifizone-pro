// DIAFA WIFIZONE PRO — Service Worker (fast-open strategy)
//
// STABLE cache name (do NOT bump per app version): the heavy, content-hashed library
// chunks are downloaded ONCE and reused across every future version, so opening the app
// is instant even on a slow connection. Only bump the "vN" if this SW logic itself changes.
const CACHE_NAME = 'diafa-wifizone-cache-v2';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Firebase / Google must always go straight to the network (live data, never cached).
const BYPASS_DOMAINS = [
  'gstatic.com', 'googleapis.com', 'firebaseio.com', 'firebasestorage.googleapis.com',
  'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (BYPASS_DOMAINS.some((d) => url.includes(d)) || e.request.method !== 'GET' || url.includes('sw.js')) {
    return; // let the network handle it
  }

  // Content-hashed build files (…/assets/index-XXXX.js) are immutable: a given URL never
  // changes content. CACHE-FIRST = served instantly from cache, no network wait.
  if (url.includes('/assets/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached))
    );
    return;
  }

  // index.html / manifest / icons / navigation → NETWORK-FIRST (these are small, so it stays
  // fast, and it lets a freshly deployed version be picked up immediately). Falls back to the
  // cached copy when offline so the app still opens.
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
