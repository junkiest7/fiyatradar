/**
 * FiyatRadar Service Worker (v17)
 * Network-first for app shell so iPhone PWA always gets instant updates,
 * with cache fallback when offline, plus native iOS 16.4+ Web Push notifications.
 */

const CACHE_NAME = "fiyatradar-v18";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/chart.js",
  "/scanner.js",
  "/mediaSearch.js",
  "/shareCard.js",
  "/pushClient.js",
  "/manifest.webmanifest?v=10",
  "/icons/apple-touch-icon.png?v=10",
  "/icons/icon-192.png?v=10",
  "/icons/icon-512.png?v=10",
  "/icons/favicon-32.png?v=10",
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

  // API & Share redirects: Network-only with graceful offline JSON
  if (url.pathname.startsWith("/api/") || url.pathname === "/share") {
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

// Native iOS 16.4+ & Desktop Lock-Screen Web Push Notifications
self.addEventListener("push", (event) => {
  let data = {
    title: "FiyatRadar Fiyat Alarmı",
    body: "Takip listenizdeki bir üründe yeni fiyat hareketi var.",
    url: "/?view=watchlist",
    tag: "fiyatradar-alert",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        data = { ...data, ...parsed };
      }
    }
  } catch {
    try {
      const txt = event.data?.text();
      if (txt) data.body = txt;
    } catch {
      // Use default payload
    }
  }

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png?v=10",
    badge: "/icons/favicon-32.png?v=10",
    tag: data.tag || "fiyatradar-alert",
    renotify: true,
    data: { url: data.url || "/?view=watchlist" },
    vibrate: [120, 60, 120],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      typeof self.navigator?.setAppBadge === "function" && data.badgeCount
        ? self.navigator.setAppBadge(data.badgeCount).catch(() => {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/?view=watchlist";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus();
          client.postMessage({ type: "FIYATRADAR_NAVIGATE", url: targetUrl });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
