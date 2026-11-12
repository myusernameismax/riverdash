// Offline shell. The app always opens from the copy saved on the phone, so it
// starts instantly with no signal (or a bad one). Updates are checked in the
// background: the page asks "check" and this compares each file's version tag
// (ETag) with GitHub's using tiny HEAD requests. Only if something changed are
// the changed files downloaded; they're swapped in all together (never half old,
// half new) and the page then reloads into the new version.
// NOAA / Open-Meteo data is cached separately by js/data.js.
const SHELL = "rivertides-shell-v4";
const FILES = ["./", "index.html", "css/app.css", "js/app.js", "js/config.js", "js/data.js", "js/chart.js",
               "js/icons.js", "js/fmt.js", "js/morph.js", "js/qr.js", "js/share.js", "manifest.webmanifest", "icons/apple-touch-icon.png",
               "icons/icon-192.png", "icons/icon-512.png", "data/gauges.json", "data/tides.json"];

self.addEventListener("install", e => {
    // cache: "reload" skips the browser's own cache, so this is really the latest
    e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
        .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("rivertides-shell") && k !== SHELL)
        .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Saved copy first; the network only for something not saved yet.
self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET" || url.origin !== location.origin) return;   // APIs go straight out
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
        fetch(e.request).then(r => {
            if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
            return r;
        }).catch(() => caches.match("./"))));
});

const tag = r => r ? (r.headers.get("ETag") || r.headers.get("Last-Modified") || "") : "";
function timed(url, opts, sec) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), sec * 1000);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// "check" from the page -> replies {updated: true} once a new version is saved.
let checking = null;
async function check() {
    const c = await caches.open(SHELL);
    const changed = [];
    await Promise.all(FILES.map(async f => {
        const [have, head] = await Promise.all([c.match(f), timed(f, { method: "HEAD", cache: "no-store" }, 8)]);
        if (!head.ok) throw new Error("can't check " + f);
        const now = tag(head);
        if (!have || (now && now !== tag(have))) changed.push(f);
    }));
    if (!changed.length) return false;
    // download every changed file first; save them only if all arrived
    const got = await Promise.all(changed.map(f => timed(f, { cache: "no-store" }, 30).then(r => {
        if (!r.ok) throw new Error("can't get " + f);
        return [f, r];
    })));
    await Promise.all(got.map(([f, r]) => c.put(f, r)));
    return true;
}
self.addEventListener("message", e => {
    if (!e.data || e.data.type !== "check" || !e.ports[0]) return;
    const port = e.ports[0];
    checking = checking || check().catch(() => false).finally(() => { checking = null; });
    e.waitUntil(checking.then(updated => port.postMessage({ updated })));
});
