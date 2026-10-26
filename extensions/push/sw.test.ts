import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

type Handler = (event: unknown) => void;
type Shown = {
    title: string;
    options: { body: string; icon: string; tag: string; data: { url: string } };
};
type FakeWindow = { url: string; focused: boolean; navigated: string[]; failNavigate?: boolean };

const ORIGIN = "https://pi.example.com";

async function worker(windows: FakeWindow[] = []) {
    const handlers = new Map<string, Handler>();
    const shown: Shown[] = [];
    const opened: string[] = [];
    const self = {
        location: { origin: ORIGIN },
        addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
        registration: {
            showNotification: (title: string, options: Shown["options"]) => {
                shown.push({ title, options });

                return Promise.resolve();
            },
        },
        clients: {
            matchAll: () =>
                Promise.resolve(
                    windows.map((window) => ({
                        url: window.url,
                        focus: () => {
                            window.focused = true;

                            return Promise.resolve();
                        },
                        navigate: (url: string) => {
                            if (window.failNavigate === true) {
                                return Promise.reject(new Error("not controlled"));
                            }

                            window.navigated.push(url);

                            return Promise.resolve();
                        },
                    })),
                ),
            openWindow: (url: string) => {
                opened.push(url);

                return Promise.resolve();
            },
        },
    };

    runInNewContext(await readFile(new URL("./sw.js", import.meta.url), "utf8"), { self, URL });

    const push = async (data: unknown, raw?: string) => {
        let waited: Promise<unknown> = Promise.resolve();

        handlers.get("push")?.({
            data: { json: () => (raw === undefined ? data : JSON.parse(raw)) },
            waitUntil: (promise: Promise<unknown>) => {
                waited = promise;
            },
        });
        await waited;
    };
    const click = async (url: unknown) => {
        let waited: Promise<unknown> = Promise.resolve();
        let closed = false;

        handlers.get("notificationclick")?.({
            notification: { data: { url }, close: () => (closed = true) },
            waitUntil: (promise: Promise<unknown>) => {
                waited = promise;
            },
        });
        await waited;

        return closed;
    };

    return { push, click, shown, opened };
}

void describe("push worker", () => {
    void it("shows the payload with the project icon and a session link", async () => {
        const sw = await worker();

        await sw.push({
            title: "Pi finished",
            body: "Done",
            url: "/?session=12",
            tag: "session-12",
        });

        assert.deepEqual(JSON.parse(JSON.stringify(sw.shown)), [
            {
                title: "Pi finished",
                options: {
                    body: "Done",
                    icon: "/icons/icon-192.png",
                    tag: "session-12",
                    data: { url: "/?session=12" },
                },
            },
        ]);
    });

    void it("still shows a generic notification for a bad payload", async () => {
        const sw = await worker();

        await sw.push(null, "{not json");
        await sw.push(42);

        assert.equal(sw.shown.length, 2);
        assert.equal(sw.shown[0]?.title, "Pi");
        assert.equal(sw.shown[0]?.options.data.url, "/");
    });

    void it("drops links that leave the app", async () => {
        const sw = await worker();

        for (const url of [
            "https://evil.example.com/?session=1",
            "//evil.example.com/",
            "javascript:alert(1)",
            "/admin",
            "/?session=1&x=2",
            "/?session=abc",
            "/?session=1#x",
            `${ORIGIN}/other`,
            5,
        ]) {
            await sw.push({ url });
        }

        assert.ok(sw.shown.every((item) => item.options.data.url === "/"));
        await sw.push({ url: `${ORIGIN}/?session=9` });
        assert.equal(sw.shown.at(-1)?.options.data.url, "/?session=9");
    });

    void it("focuses and navigates an open window of the app", async () => {
        const other = { url: "https://other.example.com/", focused: false, navigated: [] };
        const mine = { url: `${ORIGIN}/?session=2`, focused: false, navigated: [] as string[] };
        const sw = await worker([other, mine]);

        assert.equal(await sw.click("/?session=5"), true);
        assert.equal(mine.focused, true);
        assert.deepEqual(mine.navigated, ["/?session=5"]);
        assert.equal(other.focused, false);
        assert.deepEqual(sw.opened, []);
    });

    void it("opens a window when none is open or the open one cannot navigate", async () => {
        const none = await worker();

        await none.click("/?session=5");
        assert.deepEqual(none.opened, ["/?session=5"]);

        const stuck = await worker([
            { url: `${ORIGIN}/`, focused: false, navigated: [], failNavigate: true },
        ]);

        await stuck.click("/?session=6");
        assert.deepEqual(stuck.opened, ["/?session=6"]);
    });

    void it("re-checks the link when the notification is clicked", async () => {
        const sw = await worker();

        await sw.click("https://evil.example.com/");
        assert.deepEqual(sw.opened, ["/"]);
    });
});
