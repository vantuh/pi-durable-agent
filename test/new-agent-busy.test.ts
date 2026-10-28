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
    const root = await mkdtemp(join(tmpdir(), "new-agent-busy-"));
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
        join(REPO, "test", "fixtures", "faux-agent-model.ts"),
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

/** Every list the sidebar's stream sends. Nobody opens any session. */
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

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("an agent started after the server did", () => {
    void it("shows as working in the session list and for extensions, without anyone opening it", async () => {
        const { base, output, cwd } = await sandboxServer();
        const created = await post(base, "/api/sessions", { cwd });
        const parent =
            typeof created === "object" && created !== null
                ? Number(Reflect.get(created, "session"))
                : 0;
        const watch = watchList(base);
        const childRow = (list: SessionSummary[]): SessionSummary | undefined =>
            list.find((row) => row.parent === parent);
        /** The names in the strip of the parent: the agents the extension saw working. */
        const working = async (): Promise<unknown[]> => {
            const answer = await post(base, "/api/extensions/subagents/actions/strip", {
                session: parent,
            });
            const result =
                typeof answer === "object" && answer !== null
                    ? Reflect.get(answer, "result")
                    : null;
            const agents =
                typeof result === "object" && result !== null ? Reflect.get(result, "agents") : [];

            return Array.isArray(agents)
                ? agents.map((agent: unknown) => Reflect.get(Object(agent), "name"))
                : [];
        };

        try {
            await delay(300);
            await post(base, "/api/messages", { session: parent, text: "spawn Alpha" });

            const until = async (done: () => boolean | Promise<boolean>): Promise<void> => {
                for (let attempt = 0; attempt < 80; attempt++) {
                    if (await done()) {
                        return;
                    }

                    await delay(100);
                }

                assert.fail(`timed out\n${output()}`);
            };

            await until(() => watch.lists.some((list) => childRow(list)?.busy === true));
            assert.deepEqual(await working(), ["Alpha"], "the extension saw the agent work");

            await until(() => {
                const last = watch.lists.at(-1);

                return last !== undefined && childRow(last)?.busy === false;
            });
            assert.deepEqual(await working(), [], "and saw it stop");
        } finally {
            watch.stop();
        }
    });
});
