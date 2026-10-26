// Appended to the production service worker by the build. Plain script: no imports.
(() => {
    const ICON = "/icons/icon-192.png";
    const TITLE_MAX = 80;
    const BODY_MAX = 200;

    // A notification may only open this app's own root or one of its conversations, whatever it carries.
    function safeUrl(value) {
        try {
            const url = new URL(String(value), self.location.origin);

            if (url.origin !== self.location.origin || url.pathname !== "/" || url.hash !== "") {
                return "/";
            }

            return url.search === "" || /^\?session=[1-9]\d{0,15}$/.test(url.search)
                ? `/${url.search}`
                : "/";
        } catch {
            return "/";
        }
    }

    function text(value, fallback, max) {
        return typeof value === "string" && value !== "" ? value.slice(0, max) : fallback;
    }

    self.addEventListener("push", (event) => {
        let data = null;

        try {
            data = event.data ? event.data.json() : null;
        } catch {
            data = null;
        }

        const payload = data !== null && typeof data === "object" ? data : {};

        // A push must always show something, so a bad payload still gives a generic notification.
        event.waitUntil(
            self.registration.showNotification(text(payload.title, "Pi", TITLE_MAX), {
                body: text(payload.body, "Open the app to see.", BODY_MAX),
                icon: ICON,
                tag: typeof payload.tag === "string" ? payload.tag.slice(0, 64) : "pi",
                data: { url: safeUrl(payload.url) },
            }),
        );
    });

    self.addEventListener("notificationclick", (event) => {
        event.notification.close();

        const data = event.notification.data;
        const url = safeUrl(data !== null && typeof data === "object" ? data.url : "/");

        event.waitUntil(
            (async () => {
                const windows = await self.clients.matchAll({
                    type: "window",
                    includeUncontrolled: true,
                });
                const existing = windows.find((client) =>
                    client.url.startsWith(self.location.origin),
                );

                if (existing) {
                    try {
                        await existing.focus();
                        await existing.navigate(url);

                        return;
                    } catch {
                        // A window that cannot navigate (not controlled) is replaced by a new one.
                    }
                }

                await self.clients.openWindow(url);
            })(),
        );
    });
})();
