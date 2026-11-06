/**
 * The completion popup scrolls in the app's scroll area, and the arrow keys carry the marked row
 * into view inside it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answer, writeEvent } from "../server/http.ts";
import type { ServerEvent, SessionsEvent } from "../shared/protocol.ts";
import { defaultAnswer } from "./fixtures/api-defaults.ts";
import { findChromium, withBrowserApp, type ApiHandler } from "./fixtures/browser.ts";

const SESSION = 1;
const LOAD_MS = 30_000;
const SHOWN_MS = 10_000;

const hello: ServerEvent = {
    type: "hello",
    session: SESSION,
    entries: [],
    live: { busy: false, usage: { input: 0, output: 0, cost: 0 } },
    model: "faux/m1",
    more: false,
};

const SESSIONS: SessionsEvent = {
    type: "sessions",
    sessions: [
        {
            id: SESSION,
            archived: false,
            name: null,
            title: "a session",
            cwd: null,
            model: "faux/m1",
            thinkingLevel: "off",
            busy: false,
            activeAt: Date.now(),
            unseen: false,
        },
    ],
};

const WRITE_SLASH = `(() => {
    const area = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;

    area.focus();
    setter.call(area, "/");
    area.dispatchEvent(new Event("input", { bubbles: true }));
})()`;

const ARROW_DOWN = `document.querySelector("textarea").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
)`;

const POPUP = `document.querySelector('[cmdk-root]')`;
const SCROLLER = `${POPUP}.querySelector('[data-radix-scroll-area-viewport]')`;
const MARKED = `${POPUP}.querySelector('[cmdk-item][aria-selected="true"]')`;

const api: ApiHandler = (_request, response, url) => {
    if (url.pathname === "/api/health") {
        answer(response, 200, { cwd: "/", home: "/", model: "faux/m1", session: SESSION });

        return;
    }

    if (url.pathname === "/api/sessions/events" || url.pathname === "/api/events") {
        response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
        });
        writeEvent(
            response,
            `data: ${JSON.stringify(url.pathname === "/api/events" ? hello : SESSIONS)}\n\n`,
        );

        return;
    }

    if (url.pathname === "/api/skills") {
        const skills = Array.from({ length: 30 }, (_, index) => ({
            name: `skill-${String(index)}`,
            description: `Skill number ${String(index)}`,
        }));

        answer(response, 200, { skills });

        return;
    }

    answer(response, 200, defaultAnswer(url.pathname));
};

void describe("the completion popup", () => {
    void it("scrolls in the scroll area and keeps the marked row in view", async (t) => {
        const found = await findChromium(t);

        if (found === undefined) {
            return;
        }

        await withBrowserApp(found, api, async ({ open, read, until }) => {
            await open(`/?session=${String(SESSION)}`);
            assert.equal(await until(`document.querySelector("textarea") !== null`, LOAD_MS), true);

            await read(WRITE_SLASH);
            assert.equal(await until(`${POPUP} !== null && ${MARKED} !== null`, SHOWN_MS), true);
            assert.equal(
                await read(`${SCROLLER}.scrollHeight > ${SCROLLER}.clientHeight`),
                true,
                "the list is longer than its box",
            );
            assert.equal(
                await read(`${SCROLLER}.offsetWidth === ${SCROLLER}.clientWidth`),
                true,
                "no native scrollbar",
            );

            for (let press = 0; press < 12; press += 1) {
                await read(ARROW_DOWN);
            }

            assert.equal(
                await until(
                    `(() => {
                        const box = ${SCROLLER}.getBoundingClientRect();
                        const row = ${MARKED}.getBoundingClientRect();

                        return ${SCROLLER}.scrollTop > 0 && row.top >= box.top && row.bottom <= box.bottom;
                    })()`,
                    SHOWN_MS,
                ),
                true,
                "the marked row scrolled into view",
            );
        });
    });
});
