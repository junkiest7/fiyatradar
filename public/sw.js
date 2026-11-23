/**
 * FiyatRadar Service Worker (v8)
 * Network-first for app shell so iPhone PWA always gets instant updates,
 * with cache fallback when offline.
 */

const CACHE_NAME = "fiyatradar-v8";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/chart.js",
  "/scanner.js",
  "/mediaSearch.js",
  "/shareCard.js",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API requests: Network-only with graceful offline JSON
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            JSON.stringify({
              error: "İnternet bağlantısı yok. Canlı fiyat sorgulamak için bağlantınızı kontrol edin.",
              offline: true,
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }
          )
      )
    );
    return;
  }

  // Static app shell: Network-first so iPhone PWA immediately loads new updates
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
