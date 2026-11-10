// Offline shell: the app's own files are fetched fresh when there's a connection
// (so a push to GitHub shows up on the next open) and served from the cache when
// there isn't. NOAA / Open-Meteo data is cached separately by js/data.js.
const SHELL = "rivertides-shell-v2";
const FILES = ["./", "index.html", "css/app.css", "js/app.js", "js/config.js", "js/data.js", "js/chart.js",
               "js/icons.js", "js/fmt.js", "js/morph.js", "manifest.webmanifest", "icons/apple-touch-icon.png",
               "icons/icon-192.png", "data/gauges.json", "data/tides.json"];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("rivertides-shell") && k !== SHELL)
        .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET" || url.origin !== location.origin) return;   // APIs go straight out
    e.respondWith(
        fetch(e.request).then(r => {
            if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
            return r;
        }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./")))
    );
});
