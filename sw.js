// This service worker is intentionally retired — it was causing devices to keep
// serving an old cached version of the app after updates. Any device that still has
// the previous version installed will load this file, which immediately removes
// itself and clears its caches, then gets out of the way entirely.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
