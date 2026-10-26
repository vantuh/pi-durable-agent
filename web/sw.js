// Offline shell only. Template: pwa.ts fills VERSION and PRECACHE at build time.
// It never touches /api (events, uploads, conversation data) or any other dynamic route.
const PREFIX = "pi-durable-agent-shell-";
const VERSION = "__VERSION__";
const PRECACHE = ["__PRECACHE__"];
const CACHE = PREFIX + VERSION;

// No skipWaiting: a new worker waits until every open tab closes, so an update never
// reloads a live conversation.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) =>
                cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))),
            ),
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
