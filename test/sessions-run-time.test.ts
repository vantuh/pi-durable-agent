/**
 * A session's time in the list is what sorts its row and what the sidebar's "time ago" counts from. A run started
 * by an extension — a subagent's second task, a report, a queued follow-up — never comes through a person's
 * `POST /api/messages`, which is where the clock used to be written; a session with no other writer kept the time
 * of its first list read while it went on working. This watches a real server give one agent a second task.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { SessionSummary, SessionsEvent } from "../shared/protocol.ts";

const REPO = join(import.meta.dirname, "..");
/** A debounce is 100 ms: this covers the last frame of a run plus the settle that follows it. */
const SETTLE_MS = 600;
/** Long enough that a second run's time is unmistakably later than the first one's. */
const SECOND_RUN_GAP_MS = 1200;
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

/** A real server in a temporary folder with the subagents extension and a faux model, nothing else. */
async function sandboxServer(): Promise<{ base: string; output: () => string; cwd: string }> {
    const root = await mkdtemp(join(tmpdir(), "sessions-run-time-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions", "subagents"), { recursive: true });
    await mkdir(join(cwd, "extensions", "fauxmodel"), { recursive: true });
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });

    for (const file of ["server.ts", "profiles.ts", "refs.ts"]) {
        await symlink(
            join(REPO, "extensions", "subagents", file),
            join(cwd, "extensions", "subagents", file),
        );
    }

    await symlink(
        join(REPO, "test", "fixtures", "faux-agent-second-run-model.ts"),
        join(cwd, "extensions", "fauxmodel", "server.ts"),
    );
    await writeFile(
        join(cwd, ".pi", "agents", "counter.md"),
        "---\nname: counter\ndescription: Counts files.\ntools: read\nmodel: fx/m1\nthinking: low\n---\nCount.\n",
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

function rowOf(list: SessionSummary[], session: number): SessionSummary | undefined {
    return list.find((row) => row.id === session);
}

/** The agent's own conversation, which only the extension ever gave work. */
function agentRow(list: SessionSummary[], parent: number): SessionSummary | undefined {
    return list.find((row) => row.parent === parent);
}

function sessionOf(answer: unknown): number {
    assert.ok(typeof answer === "object" && answer !== null, "a session was created");

    return Number(Reflect.get(answer, "session"));
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("a session's time in the list", () => {
    void it("follows the start of a run nobody posted, not the session's first list read", async () => {
        const { base, output, cwd } = await sandboxServer();
        const parent = sessionOf(await post(base, "/api/sessions", { cwd }));
        const watch = watchList(base);

        try {
            await delay(SETTLE_MS);
            await post(base, "/api/messages", { session: parent, text: "spawn Alpha" });
            await until(watch, (list) => agentRow(list, parent)?.busy === true, output);
            await until(
                watch,
                (list) => {
                    const row = agentRow(list, parent);

                    return row !== undefined && !row.busy && row.endedAt !== undefined;
                },
                output,
            );

            const agent = agentRow(watch.lists.at(-1) ?? [], parent);

            assert.ok(agent !== undefined, "the agent's session is in the list");
            assert.equal(typeof agent.activeAt, "number", "its first run gave its row a time");
            const first = agent.activeAt ?? 0;

            // A session a person creates now, so the agent's first run is older than a row it should pass.
            await delay(SECOND_RUN_GAP_MS);
            const newer = sessionOf(await post(base, "/api/sessions", { cwd }));

            await until(watch, (list) => (rowOf(list, newer)?.activeAt ?? 0) > 0, output);
            const newerAt = rowOf(watch.lists.at(-1) ?? [], newer)?.activeAt ?? 0;

            assert.ok(
                newerAt > first,
                `the new session (${String(newerAt)}) is newer than the agent's first run (${String(first)})`,
            );

            // The agent's second run: `agent_send` submits to its conversation, and no POST goes to it.
            await delay(SECOND_RUN_GAP_MS);
            await post(base, "/api/messages", { session: parent, text: "send Alpha" });
            await until(watch, (list) => agentRow(list, parent)?.busy === true, output);
            await until(
                watch,
                (list) => {
                    const row = agentRow(list, parent);

                    return row !== undefined && !row.busy && (row.endedAt ?? 0) > newerAt;
                },
                output,
            );

            const second = agentRow(watch.lists.at(-1) ?? [], parent)?.activeAt ?? 0;

            assert.ok(
                second > newerAt,
                `the agent's second run moved its time to ${String(second)}, ` +
                    `past the ${String(newerAt)} of a newer session`,
            );
            assert.ok(second > first, `and past its own first run's ${String(first)}`);
        } finally {
            watch.stop();
        }
    });
});
