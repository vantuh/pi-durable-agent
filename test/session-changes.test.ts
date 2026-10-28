import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { ServerEvent } from "../shared/protocol.ts";

const MAIN = join(import.meta.dirname, "../server/main.ts");
const roots: string[] = [];
const running: ChildProcess[] = [];

// Calls `host.notifySessionChanged` for the session an action is called from, as an extension would.
const NOTIFIER = `export default (host) => ({ name: host.name });
export const actions = (host) => ({
    ping: ({ session }) => {
        host.notifySessionChanged(session.id);
        return null;
    },
});
`;

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

async function serverWithNotifier(): Promise<{ base: string; output: () => string }> {
    const root = await mkdtemp(join(tmpdir(), "session-changes-"));

    roots.push(root);
    await mkdir(join(root, "cwd", "extensions", "notifier"), { recursive: true });
    await writeFile(join(root, "cwd", "extensions", "notifier", "server.ts"), NOTIFIER);

    const port = await freePort();
    const child = spawn(process.execPath, [MAIN], {
        cwd: join(root, "cwd"),
        env: {
            PATH: process.env["PATH"] ?? "",
            HOME: root,
            PORT: String(port),
            PI_DURABLE_DATA_DIR: join(root, "data"),
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

    return { base: `http://127.0.0.1:${String(port)}`, output: () => output };
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

/** The `live` events of one session's stream, as they arrive. */
function liveEvents(base: string, session: number): { events: ServerEvent[]; stop: () => void } {
    const events: ServerEvent[] = [];
    const abort = new AbortController();

    void (async () => {
        const response = await fetch(`${base}/api/events?session=${String(session)}`, {
            signal: abort.signal,
        });
        const decoder = new TextDecoder();
        let pending = "";

        for await (const chunk of response.body ?? []) {
            pending += decoder.decode(chunk, { stream: true });

            const frames = pending.split("\n\n");

            pending = frames.pop() ?? "";

            for (const frame of frames) {
                if (frame.startsWith("data: ")) {
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server writes ServerEvent JSON
                    events.push(JSON.parse(frame.slice(6)) as ServerEvent);
                }
            }
        }
    })().catch(() => undefined);

    return { events, stop: () => abort.abort() };
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("host.notifySessionChanged", () => {
    void it("sends the session's live state again with a new revision, once per burst", async () => {
        const { base, output } = await serverWithNotifier();
        const created = await post(base, "/api/sessions", {});
        const session =
            typeof created === "object" && created !== null ? Reflect.get(created, "session") : 0;

        assert.equal(typeof session, "number", output());

        const watch = liveEvents(base, Number(session));
        const another = await post(base, "/api/sessions", {});
        const other = liveEvents(
            base,
            typeof another === "object" && another !== null
                ? Number(Reflect.get(another, "session"))
                : 0,
        );
        const revisions = (): (number | undefined)[] =>
            watch.events.flatMap((event) => (event.type === "live" ? [event.live.revision] : []));

        try {
            await delay(500);

            const hello = watch.events.find((event) => event.type === "hello");

            assert.ok(hello, "the stream says hello first");
            assert.equal(hello.type === "hello" ? hello.live.revision : -1, undefined);

            const before = revisions().length;

            await Promise.all(
                Array.from({ length: 8 }, () =>
                    post(base, "/api/extensions/notifier/actions/ping", { session }),
                ),
            );
            await delay(800);

            assert.deepEqual(revisions().slice(before), [1], "eight notifies, one event");

            await post(base, "/api/extensions/notifier/actions/ping", { session });
            await delay(800);

            assert.deepEqual(revisions().slice(before), [1, 2], "the next burst moves it again");
            assert.equal(
                other.events.some(
                    (event) => event.type === "live" && event.live.revision !== undefined,
                ),
                false,
                "no other session hears of it",
            );
        } finally {
            watch.stop();
            other.stop();
        }
    });
});
