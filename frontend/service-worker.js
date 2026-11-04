// Network first: always try for the newest files, and fall back to the saved
// copy only when the device is offline. The old version served saved copies
// first, so phones kept running an outdated script.js after every update.
const CACHE_NAME = "attendsure-v2";

const urlsToCache = [
  "/",
  "/index.html",
  "/style.css"
];

// Install: save a few pages for offline use and take over straight away.
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch(() => {})
  );
});

// Activate: remove old caches (including attendsure-v1) and control open pages.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: only handle this site's own pages and files. API calls to the backend
// and everything that is not a plain GET go straight to the network.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
