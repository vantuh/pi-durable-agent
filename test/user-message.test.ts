import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { answer, writeEvent } from "../server/http.ts";
import type { ClientEntry, ServerEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import { field, findChromium, withBrowserApp } from "./fixtures/browser.ts";
import { startVite } from "./fixtures/vite.ts";

async function renderMessage(user: Extract<ClientEntry, { kind: "user" }>): Promise<string> {
    const { vite, stop } = await startVite("custom", {
        optimizeDeps: { noDiscovery: true },
    });

    try {
        const { UserMessage } = await vite.ssrLoadModule("/src/transcript/turn/user-message.tsx");

        const { TooltipProvider } = await vite.ssrLoadModule("/src/components/ui/tooltip.tsx");

        return renderToStaticMarkup(
            createElement(TooltipProvider, null, createElement(UserMessage, { user })),
        );
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
                assert.equal(time.getAttribute("title"), null);
                assert.equal(time.parentElement?.tagName, "BUTTON");
            } finally {
                if (previous === undefined) {
                    delete process.env["TZ"];
                } else {
                    process.env["TZ"] = previous;
                }
            }
        });
    }

    void it("keeps a compact clock with the full local date and time on hover or keyboard focus", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        const user = { id: 1, kind: "user", text: "hello" } as const;
        const at = Date.parse("2026-01-15T14:05:00.000Z");
        const hello: ServerEvent = {
            type: "hello",
            session: 1,
            entries: [
                { ...user, at },
                { ...user, id: 2, text: "hello without time" },
                { ...user, id: 3, at, text: "a longer message ".repeat(30) },
            ],
            live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
            model: "faux/m1",
            more: false,
        };

        await withBrowserApp(
            found,
            (_request, response, url) => {
                if (url.pathname === "/api/health") {
                    answer(response, 200, {
                        cwd: "/tmp",
                        home: "/tmp",
                        model: "faux/m1",
                        session: 1,
                    });
                } else if (url.pathname.endsWith("/events")) {
                    response.writeHead(200, { "content-type": "text/event-stream" });
                    writeEvent(
                        response,
                        `data: ${JSON.stringify(
                            url.pathname === "/api/events"
                                ? hello
                                : { type: "sessions", sessions: [] },
                        )}\n\n`,
                    );
                } else {
                    answer(response, 200, defaultAnswer(url.pathname));
                }
            },
            async (page) => {
                await page.send("Emulation.setTimezoneOverride", { timezoneId: "Europe/Kyiv" });
                for (const width of [1280, 390]) {
                    await page.send("Emulation.setDeviceMetricsOverride", {
                        width,
                        height: 900,
                        deviceScaleFactor: 1,
                        mobile: false,
                    });
                    await page.open("/?session=1");
                    assert.equal(
                        await page.until(`document.querySelectorAll("time").length === 2`, 30_000),
                        true,
                        "the component and its real stylesheet loaded",
                    );
                    await page.read("document.fonts.ready.then(() => true)");
                    assert.equal(
                        await page.seen(`(() => {
                            const [shortTime, longTime] = document.querySelectorAll("time");
                            const short = shortTime.parentElement.parentElement;
                            const long = longTime.parentElement.parentElement;
                            const plain = [...document.querySelectorAll("p")]
                                .find((p) => p.textContent === "hello without time").parentElement.parentElement;
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

                const tooltipShown = `document.querySelector('[role="tooltip"]')?.textContent ===
                    "15.01.2026, 16:05:00"`;
                const position = await page.read(`(() => {
                    const rect = document.querySelector("time").getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                })()`);
                await page.send("Input.dispatchMouseEvent", {
                    type: "mouseMoved",
                    x: field(position, "x"),
                    y: field(position, "y"),
                });
                assert.equal(
                    await page.until(tooltipShown, 5000),
                    true,
                    "hover shows the full local date and time",
                );
                await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 800 });
                // Move beyond Radix's pointer grace area after the initial exit point.
                await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200, y: 850 });
                assert.equal(
                    await page.until(`!(${tooltipShown})`, 5000),
                    true,
                    "leaving the clock closes the tooltip before the keyboard check",
                );
                await page.send("Input.dispatchKeyEvent", {
                    type: "keyDown",
                    key: "Tab",
                    code: "Tab",
                    windowsVirtualKeyCode: 9,
                });
                await page.read('document.querySelector("time").parentElement.focus()');
                assert.equal(
                    await page.until(tooltipShown, 5000),
                    true,
                    "keyboard focus shows the full local date and time",
                );
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
