/**
 * The sidebar's list used to be sent whole after every change: a rename, a busy flip, an archive, each one every
 * row again, and a phone on a slow link waits for those bytes on each. The stream now starts a client with the
 * whole list and then carries only the rows a change touched. This watches a real server's frames: what one
 * change sends, what a burst sends, and what nothing sends at all.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";

const REPO = join(import.meta.dirname, "..");
/** A debounce is 100 ms: this covers the last frame a burst can send plus the settle after it. */
const SETTLE_MS = 600;
const roots: string[] = [];
const running: ChildProcess[] = [];

async function freePort(): Promise<number> {
    const probe = createNetServer();

    await new Promise<void>((done) => {
        probe.listen(0, "127.0.0.1", done);
    });

    const address = probe.address();

    assert.ok(address !== null && typeof address !== "string");
    await new Promise<void>((done) => {
        probe.close(() => {
            done();
        });
    });

    return address.port;
}

/** A real server in a temporary folder, with no extensions: sessions, their rows, and nothing else. */
async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const root = await mkdtemp(join(tmpdir(), "sessions-stream-frames-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions"), { recursive: true });

    const port = await freePort();
    const child = spawn(process.execPath, [join(REPO, "server", "main.ts")], {
        cwd,
        env: {
            PATH: process.env["PATH"] ?? "",
            HOME: root,
            PI_CODING_AGENT_DIR: join(root, "agent"),
            PI_DURABLE_DATA_DIR: join(root, "data"),
            MODEL: "fx/m1",
            PORT: String(port),
        },
    });
    let output = "";

    running.push(child);
    await new Promise<void>((done, fail) => {
        const onData = (chunk: Buffer): void => {
            output += chunk.toString();

            if (output.includes(`http://127.0.0.1:${String(port)}`)) {
                done();
            }
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", () => {
            fail(new Error(output));
        });
    });

    return { base: `http://127.0.0.1:${String(port)}`, output: () => output, cwd };
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

async function rootSession(base: string): Promise<number> {
    const response = await fetch(base + "/api/health");
    const health: unknown = await response.json();

    assert.ok(typeof health === "object" && health !== null, "the health answer is an object");

    return Number(Reflect.get(health, "session"));
}

function sessionOf(answer: unknown): number {
    assert.ok(typeof answer === "object" && answer !== null, "a session was created");

    return Number(Reflect.get(answer, "session"));
}

/** Every frame the sidebar's stream sends, as it arrives. */
function watchFrames(base: string): { frames: SessionsEvent[]; stop: () => void } {
    const frames: SessionsEvent[] = [];
    const abort = new AbortController();

    void (async () => {
        const response = await fetch(`${base}/api/sessions/events`, { signal: abort.signal });
        const decoder = new TextDecoder();
        let pending = "";

        for await (const chunk of response.body ?? []) {
            pending += decoder.decode(chunk, { stream: true });

            const text = pending.split("\n\n");

            pending = text.pop() ?? "";

            for (const frame of text) {
                if (frame.startsWith("data: ")) {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server writes SessionsEvent JSON
                    frames.push(JSON.parse(frame.slice(6)) as SessionsEvent);
                }
            }
        }
    })().catch(() => undefined);

    return { frames, stop: () => abort.abort() };
}

/** The frames that arrived after `from`, once a burst would have been flushed. */
async function framesAfter(
    watch: { frames: SessionsEvent[] },
    from: number,
): Promise<SessionsEvent[]> {
    await delay(SETTLE_MS);

    return watch.frames.slice(from);
}

function rowsOf(frame: SessionsEvent | undefined): SessionSummary[] {
    assert.ok(frame !== undefined, "a frame arrived");

    return frame.type === "sessions" ? frame.sessions : frame.rows;
}

function goneOf(frame: SessionsEvent | undefined): number[] {
    assert.ok(frame !== undefined, "a frame arrived");

    return frame.type === "rows" ? frame.gone : [];
}

function idsOf(rows: SessionSummary[]): number[] {
    return rows.map((row) => row.id).sort((left, right) => left - right);
}

function sorted(ids: number[]): number[] {
    return [...ids].sort((left, right) => left - right);
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("the session list stream", () => {
    void it("starts a client with the whole list, then sends the one row a rename changed", async () => {
        const { base, cwd } = await sandboxServer();
        const root = await rootSession(base);
        const first = sessionOf(await post(base, "/api/sessions", { cwd }));
        const second = sessionOf(await post(base, "/api/sessions", { cwd }));
        const watch = watchFrames(base);

        try {
            await delay(SETTLE_MS);

            const hello = watch.frames[0];

            assert.equal(hello?.type, "sessions", "a client's first frame is the whole list");
            assert.deepEqual(
                idsOf(rowsOf(hello)),
                sorted([root, first, second]),
                "and it is every session, the root included",
            );
            assert.equal(watch.frames.length, 1, "nothing follows while nothing changes");

            const at = watch.frames.length;

            await post(base, "/api/sessions/title", { session: first, title: "renamed" });

            const frames = await framesAfter(watch, at);

            assert.equal(frames.length, 1, "one change is one frame");
            assert.equal(frames[0]?.type, "rows", "and it carries rows, not the list");
            assert.deepEqual(idsOf(rowsOf(frames[0])), [first], "only the session that changed");
            assert.equal(rowsOf(frames[0])[0]?.title, "renamed");
            assert.deepEqual(goneOf(frames[0]), [], "nothing is gone");

            const reconnecting = watchFrames(base);

            try {
                await delay(SETTLE_MS);

                assert.equal(
                    reconnecting.frames[0]?.type,
                    "sessions",
                    "a reconnected client starts from the whole list again",
                );
                assert.equal(
                    rowsOf(reconnecting.frames[0]).find((row) => row.id === first)?.title,
                    "renamed",
                    "with what the last frames left behind",
                );
            } finally {
                reconnecting.stop();
            }
        } finally {
            watch.stop();
        }
    });

    void it("sends a change that touches no row nowhere", async () => {
        const { base, cwd } = await sandboxServer();
        const session = sessionOf(await post(base, "/api/sessions", { cwd }));
        const watch = watchFrames(base);

        try {
            await delay(SETTLE_MS);

            const at = watch.frames.length;

            // No run has ended, so a seen mark moves nothing a row shows.
            await post(base, "/api/sessions/seen", { session });
            await post(base, "/api/sessions/seen", { session });

            assert.deepEqual(await framesAfter(watch, at), [], "an unchanged row is not sent");
        } finally {
            watch.stop();
        }
    });

    void it("sends one frame for the changes a burst makes", async () => {
        const { base, cwd } = await sandboxServer();
        const first = sessionOf(await post(base, "/api/sessions", { cwd }));
        const second = sessionOf(await post(base, "/api/sessions", { cwd }));
        const watch = watchFrames(base);

        try {
            await delay(SETTLE_MS);

            const at = watch.frames.length;

            await Promise.all([
                post(base, "/api/sessions/title", { session: first, title: "one" }),
                post(base, "/api/sessions/title", { session: second, title: "two" }),
            ]);

            const frames = await framesAfter(watch, at);

            assert.equal(frames.length, 1, "two changes inside the debounce are one frame");
            assert.deepEqual(idsOf(rowsOf(frames[0])), sorted([first, second]));
        } finally {
            watch.stop();
        }
    });

    void it("sends a row for an archive and a gone id for a delete", async () => {
        const { base, cwd } = await sandboxServer();
        const kept = sessionOf(await post(base, "/api/sessions", { cwd }));
        const removed = sessionOf(await post(base, "/api/sessions", { cwd }));
        const watch = watchFrames(base);

        try {
            await delay(SETTLE_MS);

            const archiving = watch.frames.length;

            await post(base, "/api/sessions/archive", { session: kept, archived: true });

            const archived = await framesAfter(watch, archiving);

            assert.equal(archived.length, 1);
            assert.deepEqual(idsOf(rowsOf(archived[0])), [kept]);
            assert.equal(rowsOf(archived[0])[0]?.archived, true);

            const deleting = watch.frames.length;

            await post(base, "/api/sessions/delete", { session: removed });

            const deleted = await framesAfter(watch, deleting);

            assert.equal(deleted.length, 1);
            assert.deepEqual(goneOf(deleted[0]), [removed], "a deleted session is a gone id");
            assert.deepEqual(rowsOf(deleted[0]), [], "and no row");
        } finally {
            watch.stop();
        }
    });
});
