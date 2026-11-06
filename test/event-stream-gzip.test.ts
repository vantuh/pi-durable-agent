/**
 * The bytes a phone waits for. Both event streams and the big JSON answers travel gzipped when the client
 * takes it, a frame is flushed as it is written, and a small answer stays as it was. The app itself needs
 * nothing from this: `EventSource` and `fetch` decompress on their own. A real server runs in a temporary
 * folder, with a faux model, and the streams are read as raw HTTP so the bytes on the wire can be counted.
 */

import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createGunzip, gunzipSync, type Gunzip } from "node:zlib";

import type { ServerEvent, SessionsEvent, SessionSummary } from "../shared/protocol.ts";
import { cleanUp, linkExtension, REPO, sandbox, startServer } from "./fixtures/server.ts";

/** Rows that make the list worth compressing; a row is a few hundred bytes. */
const ROWS = 12;
/** A message whose entry alone is past the kilobyte where a gzip answer starts to gain. */
const BIG_TEXT = "x".repeat(8000);
/** The first frame of a stream is written at once; a stream held for its compressor would miss this. */
const FIRST_FRAME_MS = 500;
/** A list change is debounced by 100 ms, then written at once; this fails a frame held in the compressor. */
const NEXT_FRAME_MS = 3000;

/** A real server in a temporary folder, with a faux model that answers through a tool loop, and nothing else. */
async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const box = await sandbox("event-stream-gzip");

    await linkExtension(box, "fauxmodel", {
        "server.ts": join(REPO, "test", "fixtures", "faux-tool-loop-model.ts"),
    });

    const { base, output, cwd } = await startServer({ box, env: { MODEL: "fx/m1" } });

    return { base, output, cwd };
}

async function post(base: string, path: string, body: unknown): Promise<unknown> {
    const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    assert.equal(response.ok, true, `${path}: ${String(response.status)}`);

    return await response.json();
}

async function startSession(base: string, cwd: string): Promise<number> {
    const created = await post(base, "/api/sessions", { cwd });

    assert.ok(typeof created === "object" && created !== null, "a session was created");

    return Number(Reflect.get(created, "session"));
}

/** The rows as the browser gets them; `fetch` decompresses whatever the server sent. */
async function rows(base: string): Promise<SessionSummary[]> {
    const response = await fetch(`${base}/api/sessions`);

    assert.equal(response.ok, true);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server wrote this JSON
    return ((await response.json()) as { sessions: SessionSummary[] }).sessions;
}

/** Waits for the big message's run to end, so both streams read the same state. */
async function untilEnded(base: string, session: number, output: () => string): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
        const row = (await rows(base)).find((candidate) => candidate.id === session);

        if (row?.busy === false && row.endedAt !== undefined) {
            return;
        }

        await delay(100);
    }

    assert.fail(`the run did not end\n${output()}`);
}

/** A whole JSON answer as it came: the bytes, and whether the server compressed them. */
async function getBytes(
    base: string,
    path: string,
    accept?: string,
): Promise<{ encoding: string | undefined; body: Buffer }> {
    return await new Promise((done, fail) => {
        const request = httpGet(
            base + path,
            {
                headers: accept === undefined ? {} : { "accept-encoding": accept },
            },
            (response) => {
                const chunks: Buffer[] = [];

                response.on("data", (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    done({
                        encoding: response.headers["content-encoding"],
                        body: Buffer.concat(chunks),
                    });
                });
                response.on("error", fail);
            },
        );

        request.on("error", fail);
        request.setTimeout(5000, () => {
            request.destroy(new Error(`${path} did not answer within 5 s`));
        });
    });
}

function textOf(bytes: Buffer, encoding: string | undefined): string {
    return (encoding === "gzip" ? gunzipSync(bytes) : bytes).toString("utf8");
}

/** The event a `data:` frame carries. */
function eventOf(frame: string): ServerEvent | SessionsEvent {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server wrote this JSON
    return JSON.parse(frame) as ServerEvent | SessionsEvent;
}

type RawStream = {
    /** What the server said it sent; known once the first frame has arrived. */
    readonly encoding: string | undefined;
    /** When the first frame arrived, in milliseconds from the request. */
    readonly firstAt: number | undefined;
    /** Bytes off the wire before compression, as the raw response chunks counted them. */
    readonly received: number;
    /** Resolves with frame `count`; rejects when the stream fails or the wait runs out. */
    until: (count: number, within: number) => Promise<string>;
    stop: () => void;
};

/** One SSE stream read as raw bytes, decompressed here so a frame is what the browser would see. */
function openStream(base: string, path: string, accept?: string): RawStream {
    const started = performance.now();
    const request = httpGet(base + path, {
        headers: accept === undefined ? {} : { "accept-encoding": accept },
    });
    const decoder = new TextDecoder();
    const frames: string[] = [];
    let decompressing: Gunzip | undefined;
    let encoding: string | undefined;
    let buffered = "";
    let firstAt: number | undefined;
    let received = 0;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;

    const push = (text: string): void => {
        buffered += text;

        const parts = buffered.split("\n\n");

        buffered = parts.pop() ?? "";

        for (const part of parts) {
            if (part.startsWith("data: ")) {
                frames.push(part.slice(6));
                firstAt ??= performance.now() - started;
            }
        }

        wake?.();
    };
    const fail = (error: Error): void => {
        failure = error;
        wake?.();
    };

    request.on("response", (response) => {
        encoding = response.headers["content-encoding"];

        response.on("data", (chunk: Buffer) => {
            received += chunk.length;
        });
        response.on("error", fail);

        if (encoding === "gzip") {
            decompressing = createGunzip();
            decompressing.on("data", (chunk: Buffer) => {
                push(decoder.decode(chunk, { stream: true }));
            });
            decompressing.on("error", fail);
            response.pipe(decompressing);
        } else {
            response.on("data", (chunk: Buffer) => {
                push(decoder.decode(chunk, { stream: true }));
            });
        }
    });
    request.on("error", fail);

    const until = async (count: number, within: number): Promise<string> => {
        const end = performance.now() + within;

        while (frames.length < count) {
            if (failure !== undefined) {
                throw failure;
            }

            const left = end - performance.now();

            if (left <= 0) {
                throw new Error(
                    `${path}: ${String(count)} frame(s) did not arrive within ${String(within)} ms`,
                );
            }

            await new Promise<void>((done) => {
                const timer = setTimeout(() => {
                    wake = undefined;
                    done();
                }, left);

                wake = () => {
                    clearTimeout(timer);
                    wake = undefined;
                    done();
                };
            });
        }

        const frame = frames[count - 1];

        if (frame === undefined) {
            throw new Error(`${path}: no frame ${String(count)}`);
        }

        return frame;
    };

    return {
        get encoding() {
            return encoding;
        },
        get firstAt() {
            return firstAt;
        },
        get received() {
            return received;
        },
        until,
        stop: () => {
            request.destroy();
            decompressing?.destroy();
        },
    };
}

/** The first `data:` frame of a stream, and what it cost to get it there. */
async function firstFrame(
    base: string,
    path: string,
    accept?: string,
): Promise<{
    encoding: string | undefined;
    frame: string;
    firstAt: number | undefined;
    received: number;
}> {
    const stream = openStream(base, path, accept);

    try {
        const frame = await stream.until(1, FIRST_FRAME_MS);

        return {
            encoding: stream.encoding,
            frame,
            firstAt: stream.firstAt,
            received: stream.received,
        };
    } finally {
        stream.stop();
    }
}

after(cleanUp);

void describe("the bytes a phone waits for", () => {
    void it("are gzipped for a client that takes it, and identical to the plain ones", async () => {
        const { base, output, cwd } = await sandboxServer();
        const ids: number[] = [];

        for (let count = 0; count < ROWS; count += 1) {
            ids.push(await startSession(base, cwd));
        }

        const session = ids[0];

        assert.ok(session !== undefined, "the first session was created");

        await post(base, "/api/messages", { session, text: BIG_TEXT });
        await untilEnded(base, session, output);

        // The list: one gzipped answer and one plain answer hold the same rows.
        const plainList = await getBytes(base, "/api/sessions");
        const gzipList = await getBytes(base, "/api/sessions", "gzip");

        assert.equal(plainList.encoding, undefined, "a client without the header gets plain bytes");
        assert.equal(gzipList.encoding, "gzip", "a client that takes gzip gets it");
        assert.ok(
            plainList.body.length > 1024,
            `the list is ${String(plainList.body.length)} bytes, so it is past the threshold`,
        );
        assert.ok(
            gzipList.body.length < plainList.body.length,
            `gzipped list ${String(gzipList.body.length)} B against ${String(plainList.body.length)} B`,
        );
        assert.equal(
            textOf(gzipList.body, "gzip"),
            textOf(plainList.body, undefined),
            "the gzipped list carries the same JSON",
        );

        // A small answer is not worth a gzip header, even to a client that takes gzip.
        const missing = await getBytes(base, "/api/not-a-route", "gzip");

        assert.equal(missing.encoding, undefined);
        assert.ok(missing.body.length < 1024);

        // History pages carry the same big entry, so they are compressed the same way.
        const plainHistory = await getBytes(base, `/api/history?session=${String(session)}`);
        const gzipHistory = await getBytes(base, `/api/history?session=${String(session)}`, "gzip");

        assert.equal(plainHistory.encoding, undefined);
        assert.equal(gzipHistory.encoding, "gzip");
        assert.equal(
            textOf(gzipHistory.body, "gzip"),
            textOf(plainHistory.body, undefined),
            "the gzipped page carries the same entries",
        );

        // The conversation stream: the same `hello`, and its first frame arrives at once in both.
        const plainHello = await firstFrame(base, `/api/events?session=${String(session)}`);
        const gzipHello = await firstFrame(base, `/api/events?session=${String(session)}`, "gzip");

        assert.equal(plainHello.encoding, undefined);
        assert.equal(gzipHello.encoding, "gzip");
        assert.deepEqual(eventOf(gzipHello.frame), eventOf(plainHello.frame));
        assert.equal(eventOf(gzipHello.frame).type, "hello");
        assert.ok(
            gzipHello.received < plainHello.received,
            `the hello is ${String(gzipHello.received)} B gzipped against ${String(plainHello.received)} B plain`,
        );
        assert.ok(
            gzipHello.firstAt !== undefined && gzipHello.firstAt < FIRST_FRAME_MS,
            `the gzipped hello arrived in ${String(gzipHello.firstAt)} ms`,
        );
        assert.ok(
            plainHello.firstAt !== undefined && plainHello.firstAt < FIRST_FRAME_MS,
            `the plain hello arrived in ${String(plainHello.firstAt)} ms`,
        );

        // The list stream: the same first list, and a later frame is not held in the compressor.
        const plainListFrame = await firstFrame(base, "/api/sessions/events");
        const gzipListFrame = await firstFrame(base, "/api/sessions/events", "gzip");

        assert.equal(plainListFrame.encoding, undefined);
        assert.equal(gzipListFrame.encoding, "gzip");
        assert.deepEqual(eventOf(gzipListFrame.frame), eventOf(plainListFrame.frame));

        const watching = openStream(base, "/api/sessions/events", "gzip");

        try {
            await watching.until(1, FIRST_FRAME_MS);
            const created = await startSession(base, cwd);

            const next = eventOf(await watching.until(2, NEXT_FRAME_MS));

            if (next.type !== "rows") {
                assert.fail("the second frame carries the change, not the list again");
            }

            assert.deepEqual(
                next.rows.map((row) => row.id),
                [created],
                "the second frame carries the new row, written without waiting",
            );
        } finally {
            watching.stop();
        }
    });
});
