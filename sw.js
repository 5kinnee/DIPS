/* DIPS service worker. Bump VERSION on every release: the browser only installs a new
   worker when this file changes byte for byte, and the version names the cache. */
const VERSION = "0.2.0";
const CACHE = `dips-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "combos.js",
  "local.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  /* cache: "reload" skips the HTTP cache (GitHub Pages serves max-age=600), so a new version
     never precaches stale files. */
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(
      FILES.map(f => fetch(new Request(f, { cache: "reload" })).then(r => {
        if (!r.ok) throw new Error(`precache failed: ${f} ${r.status}`);
        return cache.put(f, r);
      }))
    ))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("dips-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The page asks for this when the user taps "Reload" on the update banner. */
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "VERSION") event.source.postMessage({ version: VERSION });
});

/* App files: cache first, so the installed app opens offline. Everything else goes to the network. */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() =>
      req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
});
