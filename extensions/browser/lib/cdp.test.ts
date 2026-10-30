import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { Connection } from "./cdp.ts";

/** Both ends of Chromium's debugging pipe without a Chromium: requests go out, replies come in, chunk by chunk. */
function pipe() {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    let out = "";

    toBrowser.setEncoding("utf8");
    toBrowser.on("data", (chunk: string) => {
        out += chunk;
    });

    const connection = new Connection(toBrowser, fromBrowser);

    return {
        connection,
        /** A piece of what the browser would write, as Chromium writes it. */
        write: (chunk: string | Buffer) => {
            fromBrowser.write(chunk);
        },
        /** What the connection wrote, as it went out. */
        sent: () => out,
    };
}

/** The id of the last request the connection wrote: a reply has to name it back. */
function lastId(sent: string): number {
    const ids = [...sent.matchAll(/"id":(\d+),/g)].map((match) => match[1]);
    const id = ids.at(-1);

    assert.ok(id !== undefined, `no request went out: ${sent}`);

    return Number(id);
}

/** A reply as the browser writes it: one JSON message, ended by a NUL byte. */
function reply(id: number, result: Record<string, unknown>): string {
    return `${JSON.stringify({ id, result })}\0`;
}

void describe("DevTools protocol framing", () => {
    void it("resolves a reply that arrives in two pieces", async () => {
        const { connection, sent, write } = pipe();
        const answer = connection.send("Page.captureScreenshot", {}, undefined, 1_000);
        const message = reply(lastId(sent()), { data: "frame" });

        write(message.slice(0, 9));
        write(message.slice(9));

        assert.deepEqual(await answer, { data: "frame" });
    });

    void it("reassembles a reply that arrives in many pieces, as a screenshot does", async () => {
        const { connection, sent, write } = pipe();
        const answer = connection.send("Page.captureScreenshot", {}, undefined, 1_000);
        const message = reply(lastId(sent()), { data: "x".repeat(200) });

        for (let at = 0; at < message.length; at += 7) {
            write(message.slice(at, at + 7));
        }

        assert.deepEqual(await answer, { data: "x".repeat(200) });
    });

    void it("resolves two replies that share one piece, each from its own request", async () => {
        const { connection, sent, write } = pipe();
        const first = connection.send("Page.navigate", { url: "about:blank" }, undefined, 1_000);
        const firstId = lastId(sent());
        const second = connection.send("Page.reload", {}, undefined, 1_000);
        const secondId = lastId(sent());

        write(reply(secondId, { reloaded: true }) + reply(firstId, { navigated: true }));

        assert.deepEqual(await first, { navigated: true });
        assert.deepEqual(await second, { reloaded: true });
    });

    void it("ends a message on a NUL that arrives in a piece of its own", async () => {
        const { connection, sent, write } = pipe();
        const first = connection.send("Page.enable", {}, undefined, 1_000);
        const firstId = lastId(sent());
        const second = connection.send("Log.enable", {}, undefined, 1_000);
        const secondId = lastId(sent());
        const message = reply(firstId, {});

        write(message.slice(0, 10));
        write(message.slice(10, -1));
        write("\0");
        write(reply(secondId, { enabled: true }) + "\0");

        assert.deepEqual(await first, {});
        assert.deepEqual(await second, { enabled: true });
    });

    void it("keeps a character whole when the bytes of a reply are split inside it", async () => {
        const { connection, sent, write } = pipe();
        const answer = connection.send("Runtime.evaluate", {}, undefined, 1_000);
        const bytes = Buffer.from(reply(lastId(sent()), { value: "привіт" }), "utf8");
        const at = bytes.indexOf(Buffer.from("п"));

        assert.ok(at > 0, "the reply holds no multi-byte character to split");

        write(bytes.subarray(0, at + 1));
        write(bytes.subarray(at + 1));

        assert.deepEqual(await answer, { value: "привіт" });
    });

    void it("hands an event without an id to its listener, beside the replies", async () => {
        const { connection, sent, write } = pipe();
        const seen: { method: string; params: unknown }[] = [];

        connection.onEvent = (method, params) => {
            seen.push({ method, params });
        };

        const answer = connection.send(
            "Target.setDiscoverTargets",
            { discover: true },
            undefined,
            1_000,
        );
        const event = `${JSON.stringify({
            method: "Target.targetCreated",
            params: { targetInfo: { targetId: "page-1" } },
        })}\0`;

        write(event + reply(lastId(sent()), {}));

        assert.deepEqual(await answer, {});
        assert.deepEqual(seen, [
            { method: "Target.targetCreated", params: { targetInfo: { targetId: "page-1" } } },
        ]);
    });
});
