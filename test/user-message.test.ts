import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ClientEntry } from "../shared/protocol.ts";
import { findChromium, withBrowserApp } from "./fixtures/browser.ts";
import { startVite } from "./fixtures/vite.ts";

async function renderMessage(user: Extract<ClientEntry, { kind: "user" }>): Promise<string> {
    const { vite, stop } = await startVite("custom", {
        optimizeDeps: { noDiscovery: true },
    });

    try {
        const { UserMessage } = await vite.ssrLoadModule("/src/transcript/turn/user-message.tsx");

        return renderToStaticMarkup(createElement(UserMessage, { user }));
    } finally {
        await stop();
    }
}

void describe("a person's message time", () => {
    for (const [zone, expected] of [
        ["Europe/Kyiv", "16:05"],
        ["America/New_York", "09:05"],
    ]) {
        void it(`shows the recorded time in ${zone}`, async () => {
            const previous = process.env["TZ"];
            process.env["TZ"] = zone;

            try {
                const at = Date.parse("2026-01-15T14:05:00.000Z");
                const html = await renderMessage({ id: 1, kind: "user", text: "hello", at });
                const { document } = parseHTML(html);
                const time = document.querySelector("time");

                assert.ok(time, html);
                assert.equal(time.textContent, expected);
                assert.equal(time.getAttribute("dateTime"), "2026-01-15T14:05:00.000Z");
                assert.equal(time.getAttribute("title"), new Date(at).toLocaleString());
            } finally {
                if (previous === undefined) {
                    delete process.env["TZ"];
                } else {
                    process.env["TZ"] = previous;
                }
            }
        });
    }

    void it("keeps the clock beside the content without adding a row on desktop or phone", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        const user = { id: 1, kind: "user", text: "hello" } as const;
        const at = Date.parse("2026-01-15T14:05:00.000Z");
        const short = await renderMessage({ ...user, at });
        const plain = await renderMessage(user);
        const long = await renderMessage({ ...user, at, text: "a longer message ".repeat(30) });
        const html = `<!doctype html><html><head>
            <link rel="stylesheet" href="/src/styles/styles.css?direct">
            </head><body><main class="flex flex-col gap-3 p-3">${short}${plain}${long}</main></body></html>`;

        await withBrowserApp(
            found,
            (_request, response) => {
                response.writeHead(200, { "content-type": "text/html" }).end(html);
            },
            async (page) => {
                for (const width of [1280, 390]) {
                    await page.send("Emulation.setDeviceMetricsOverride", {
                        width,
                        height: 900,
                        deviceScaleFactor: 1,
                        mobile: false,
                    });
                    await page.open("/api/message");
                    assert.equal(
                        await page.until(
                            `document.querySelector("main") !== null &&
                            getComputedStyle(document.querySelector("main")).display === "flex"`,
                            10_000,
                        ),
                        true,
                        "the component and its real stylesheet loaded",
                    );
                    await page.read("document.fonts.ready.then(() => true)");
                    assert.equal(
                        await page.seen(`(() => {
                            const [short, plain, long] = document.querySelector("main").children;
                            const text = short.querySelector("p").getBoundingClientRect();
                            const clock = short.querySelector("time").getBoundingClientRect();
                            const longText = long.querySelector("p").getBoundingClientRect();
                            const longClock = long.querySelector("time").getBoundingClientRect();

                            return short.offsetHeight === plain.offsetHeight &&
                                clock.top >= text.top && clock.bottom <= text.bottom &&
                                clock.left >= text.right &&
                                longText.height > text.height &&
                                longClock.bottom <= longText.bottom &&
                                longClock.left >= longText.right &&
                                document.documentElement.scrollWidth <= innerWidth;
                        })()`),
                        true,
                        `the clock adds no row or overflow at ${String(width)}px`,
                    );
                }
            },
        );
    });

    void it("does not invent a time for an older message without one", async () => {
        const html = await renderMessage({ id: 1, kind: "user", text: "hello" });
        const { document } = parseHTML(html);

        assert.equal(document.querySelector("time"), null, html);
        assert.ok(html.includes("hello"), html);
    });
});
