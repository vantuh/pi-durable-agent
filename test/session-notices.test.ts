/**
 * A notice about a session used to ride only the conversation streams, so a tab showing no session — the home
 * page, or a phone that just opened the app — heard nothing. It rides the list stream now, which every tab
 * holds, and no conversation stream says it twice. This watches a real server's two streams: what a session
 * notice reaches, and what a notice about the app itself keeps to.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { ExtensionNotice } from "../shared/protocol.ts";

const REPO = join(import.meta.dirname, "..");
/** One round trip and a flush: long enough for a frame either stream would carry to have arrived. */
const SETTLE_MS = 600;
const roots: string[] = [];
const running: ChildProcess[] = [];

/** An extension whose action says a notice the test asks for: about a session, or about the app. */
const PROBE = `
export default function (host) {
    return { name: host.name };
}

export const actions = (host) => ({
    say({ session }) {
        host.notify({
            level: "error",
            message: session === null ? "Extension “probe” reloaded" : "Fix the login bug",
            ...(session === null
                ? {}
                : {
                      session: session.id,
                      description: "Bash timed out after 1 min · sleep 91 · pi",
                  }),
        });

        return { said: session === null ? "the app" : "the session" };
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

/** A real server in a temporary folder, with one extension that says what a test tells it to. */
async function sandboxServer(): Promise<{ base: string; output: () => string }> {
    const root = await mkdtemp(join(tmpdir(), "session-notices-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions", "probe"), { recursive: true });
    await writeFile(join(cwd, "extensions", "probe", "server.ts"), PROBE);

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

    return { base: `http://127.0.0.1:${String(port)}`, output: () => output };
}

async function post(base: string, path: string, body: unknown): Promise<void> {
    const response = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    assert.equal(response.ok, true, `${path}: ${String(response.status)}`);
}

/** One stream's `data:` frames as they arrive, the heartbeat comments dropped. */
function watch(base: string, path: string): { frames: unknown[]; stop: () => void } {
    const frames: unknown[] = [];
    const abort = new AbortController();

    void (async () => {
        const response = await fetch(base + path, { signal: abort.signal });
        const decoder = new TextDecoder();
        let pending = "";

        for await (const chunk of response.body ?? []) {
            pending += decoder.decode(chunk, { stream: true });

            const text = pending.split("\n\n");

            pending = text.pop() ?? "";

            for (const frame of text) {
                if (frame.startsWith("data: ")) {
                    const parsed: unknown = JSON.parse(frame.slice(6));

                    frames.push(parsed);
                }
            }
        }
    })().catch(() => undefined);

    return { frames, stop: () => abort.abort() };
}

/** What a frame says, when it is a notice. */
function noticeIn(frame: unknown): ExtensionNotice | undefined {
    if (typeof frame !== "object" || frame === null) {
        return undefined;
    }

    if (Reflect.get(frame, "type") !== "extension-notice") {
        return undefined;
    }

    const notice: unknown = Reflect.get(frame, "notice");

    if (typeof notice !== "object" || notice === null) {
        return undefined;
    }

    const level: unknown = Reflect.get(notice, "level");
    const message: unknown = Reflect.get(notice, "message");
    const session: unknown = Reflect.get(notice, "session");
    const description: unknown = Reflect.get(notice, "description");

    if (typeof message !== "string" || (level !== "success" && level !== "error")) {
        return undefined;
    }

    return {
        level,
        message,
        ...(typeof session === "number" ? { session } : {}),
        ...(typeof description === "string" ? { description } : {}),
    };
}

/** The notices one stream carried from `from` on, once a burst would have arrived. */
async function noticesAfter(
    watching: { frames: unknown[] },
    from: number,
): Promise<ExtensionNotice[]> {
    await delay(SETTLE_MS);

    return watching.frames.slice(from).flatMap((frame) => noticeIn(frame) ?? []);
}

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("a notice an extension sends", () => {
    void it("reaches a tab holding only the list, and about the app only the conversation stream", async () => {
        const { base } = await sandboxServer();
        const health: unknown = await (await fetch(`${base}/api/health`)).json();

        assert.ok(typeof health === "object" && health !== null, "the health answer is an object");

        const root = Number(Reflect.get(health, "session"));
        const list = watch(base, "/api/sessions/events");
        // Here to show that the session notice is not said on it as well.
        const conversation = watch(base, `/api/events?session=${String(root)}`);

        try {
            await delay(SETTLE_MS);

            const hello = list.frames[0];

            assert.ok(typeof hello === "object" && hello !== null, "the list stream opened first");
            assert.equal(Reflect.get(hello, "type"), "sessions", "with the whole list");

            const listAt = list.frames.length;
            const conversationAt = conversation.frames.length;

            await post(base, `/api/extensions/probe/actions/say`, { session: root });

            const aboutSession = {
                level: "error",
                message: "Fix the login bug",
                session: root,
                description: "Bash timed out after 1 min · sleep 91 · pi",
            };

            assert.deepEqual(
                await noticesAfter(list, listAt),
                [aboutSession],
                "the tab holding only the list hears about the session",
            );
            assert.deepEqual(
                await noticesAfter(conversation, conversationAt),
                [],
                "and its conversation stream does not say it again",
            );

            const againListAt = list.frames.length;
            const againConversationAt = conversation.frames.length;

            await post(base, "/api/extensions/probe/actions/say", {});

            assert.deepEqual(
                await noticesAfter(conversation, againConversationAt),
                [{ level: "error", message: "Extension “probe” reloaded" }],
                "a notice about the app keeps to the conversation streams",
            );
            assert.deepEqual(
                await noticesAfter(list, againListAt),
                [],
                "the list stream carries nothing about the app itself",
            );
        } finally {
            list.stop();
            conversation.stop();
        }
    });
});
