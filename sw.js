// Versioned cache name — bump this (the number after "v") every time a new version is
// shipped, in lockstep with APP_VERSION in App.jsx. On activate, any cache that doesn't
// match this exact name is deleted, so a stale version can never linger on a device.
const CACHE_NAME = 'diafa-wifizone-pro-v3.5.1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Never cache or interfere with Firebase/Google requests — those must always go
// straight to the network so data stays live and correct.
const BYPASS_DOMAINS = [
  'gstatic.com', 'googleapis.com', 'firebaseio.com', 'firebasestorage.googleapis.com',
  'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}));
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
    return;
  }
  // Network-first: always try to get the freshest version; only fall back to the
  // cached copy (so the app still opens) if the network genuinely fails.
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
