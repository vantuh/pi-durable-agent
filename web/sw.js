// Offline shell only. Template: pwa.ts fills VERSION and PRECACHE at build time.
// It never touches /api (events, uploads, conversation data) or any other dynamic route.
const PREFIX = "pi-durable-agent-shell-";
const VERSION = "__VERSION__";
const PRECACHE = ["__PRECACHE__"];
const CACHE = PREFIX + VERSION;

// The shell arrives with whatever `accept-encoding` the browser sends, and the Cache API keeps the decoded
// body. A response replayed with the encoding headers of the compressed bytes claims an encoding its body no
// longer has, which iOS refuses and Chromium happens to tolerate, so the two headers are dropped here.
async function store(cache, url) {
    const response = await fetch(new Request(url, { cache: "reload" }));

    if (!response.ok) {
        throw new Error(`precache ${url}: ${String(response.status)}`);
    }

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");

    return cache.put(url, new Response(await response.arrayBuffer(), { status: 200, headers }));
}

// No skipWaiting: a new worker waits until every open tab closes, so an update never
// reloads a live conversation.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => store(cache, url)))),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((names) =>
                Promise.all(
                    names
                        .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
                        .map((name) => caches.delete(name)),
                ),
            ),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate" && url.pathname === "/") {
        event.respondWith(
            fetch(request).catch(async () => (await shellEntry("/")) ?? Response.error()),
        );
    } else if (url.pathname.startsWith("/assets/")) {
        event.respondWith(shellEntry(url.pathname).then((hit) => hit ?? fetch(request)));
    }
});

async function shellEntry(path) {
    const cache = await caches.open(CACHE);

    return cache.match(path);
}
