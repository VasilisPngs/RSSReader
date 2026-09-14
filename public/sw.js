const VERSION = "v5";
const CACHE = `rssreader-${VERSION}`;

const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/app/styles.css",
  "/app/main.js",
  "/app/db.js",
  "/app/sync.js",
  "/app/store.js",
  "/app/router.js",
  "/app/dom.js",
  "/app/i18n.js",
  "/app/sanitize.js",
  "/app/views/articles.js",
  "/app/views/article.js",
  "/app/views/feeds.js",
  "/app/views/settings.js",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip_waiting") self.skipWaiting();
});

async function staleWhileRevalidate(event, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey);
  const network = fetch(event.request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") cache.put(cacheKey, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  return response || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.searchParams.has("signin")) return;
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event, "/"));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request));
});
