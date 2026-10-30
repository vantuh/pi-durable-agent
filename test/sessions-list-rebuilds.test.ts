/**
 * The sidebar's list is rebuilt on the harness's line, one commit per row, so a rebuild per entry would make a
 * tool-heavy run rebuild it back to back. A row holds a session's name, its folder and model, whether it is
 * working, when a person last wrote to it, and when its latest run ended: none of those move when the agent
 * runs a tool. This watches a real server and counts the lists it sends while one answer runs.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";

const REPO = join(import.meta.dirname, "..");
/** Tool rounds one answer takes; each is an assistant entry plus its result. */
const ROUNDS = 20;
/** A debounce is 100 ms: this covers the last frame of a run plus the settle that follows it. */
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

/** A real server in a temporary folder, with a faux model that calls a tool repeatedly, and nothing else. */
async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const root = await mkdtemp(join(tmpdir(), "sessions-list-rebuilds-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions", "fauxmodel"), { recursive: true });
    await symlink(
        join(REPO, "test", "fixtures", "faux-tool-loop-model.ts"),
        join(cwd, "extensions", "fauxmodel", "server.ts"),
    );

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

async function get(base: string, path: string): Promise<unknown> {
    const response = await fetch(base + path);

    assert.equal(response.ok, true, `${path}: ${String(response.status)}`);

    return await response.json();
}

/** Every list the sidebar's stream sends, as it arrives. */
function watchList(base: string): { lists: SessionSummary[][]; stop: () => void } {
    const lists: SessionSummary[][] = [];
    const abort = new AbortController();

    void (async () => {
        const response = await fetch(`${base}/api/sessions/events`, { signal: abort.signal });
        const decoder = new TextDecoder();
        let pending = "";

        for await (const chunk of response.body ?? []) {
            pending += decoder.decode(chunk, { stream: true });

            const frames = pending.split("\n\n");

            pending = frames.pop() ?? "";

            for (const frame of frames) {
                if (frame.startsWith("data: ")) {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server writes SessionsEvent JSON
                    lists.push((JSON.parse(frame.slice(6)) as SessionsEvent).sessions);
                }
            }
        }
    })().catch(() => undefined);

    return { lists, stop: () => abort.abort() };
}

/** Waits for a list that satisfies `done`; fails the test with the server's output when none arrives. */
async function until(
    watch: { lists: SessionSummary[][] },
    done: (list: SessionSummary[]) => boolean,
    output: () => string,
): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const last = watch.lists.at(-1);

        if (last !== undefined && done(last)) {
            return;
        }

        await delay(100);
    }

    assert.fail(`timed out\n${output()}`);
}

/** The entries the session's log holds, newest page: the run's own account of how much it appended. */
async function entryCount(base: string, session: number): Promise<number> {
    const page = await get(base, `/api/history?session=${String(session)}`);
    const entries =
        typeof page === "object" && page !== null ? Reflect.get(page, "entries") : undefined;

    return Array.isArray(entries) ? entries.length : 0;
}

function rowOf(list: SessionSummary[], session: number): SessionSummary | undefined {
    return list.find((row) => row.id === session);
}

async function startSession(base: string, cwd: string): Promise<number> {
    const created = await post(base, "/api/sessions", { cwd });

    assert.ok(typeof created === "object" && created !== null, "a session was created");

    return Number(Reflect.get(created, "session"));
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("the session list during a run", () => {
    void it("is not rebuilt for entries that cannot change a row", async () => {
        const { base, output, cwd } = await sandboxServer();
        const session = await startSession(base, cwd);
        const watch = watchList(base);

        try {
            await delay(SETTLE_MS);

            const before = watch.lists.length;

            await post(base, "/api/messages", { session, text: "work for a while" });
            await until(watch, (list) => rowOf(list, session)?.busy === true, output);
            await until(watch, (list) => rowOf(list, session)?.busy === false, output);
            await delay(SETTLE_MS);

            const entries = await entryCount(base, session);
            const rebuilt = watch.lists.length - before;

            assert.ok(
                entries > ROUNDS,
                `the run appended ${String(entries)} entries, so the count is worth taking`,
            );
            assert.ok(
                rebuilt <= 4,
                `${String(entries)} entries rebuilt the list ${String(rebuilt)} times; ` +
                    `a row can only change when it starts or stops working, is named, or is touched`,
            );
        } finally {
            watch.stop();
        }
    });

    void it("is rebuilt for the first question, the working mark, the end, and a new message", async () => {
        const { base, output, cwd } = await sandboxServer();
        const session = await startSession(base, cwd);
        const watch = watchList(base);

        try {
            await delay(SETTLE_MS);
            await post(base, "/api/messages", { session, text: "work for a while" });

            await until(
                watch,
                (list) => rowOf(list, session)?.title === "work for a while",
                output,
            );
            await until(watch, (list) => rowOf(list, session)?.busy === true, output);
            await until(
                watch,
                (list) => {
                    const row = rowOf(list, session);

                    return row?.busy === false && row.unseen && row.endedAt !== undefined;
                },
                output,
            );

            const ended = rowOf(watch.lists.at(-1) ?? [], session)?.activeAt;

            assert.ok(typeof ended === "number", "the list carries when a person last wrote");

            await post(base, "/api/messages", { session, text: "one more" });
            await until(watch, (list) => (rowOf(list, session)?.activeAt ?? 0) > ended, output);
        } finally {
            watch.stop();
        }
    });
});
