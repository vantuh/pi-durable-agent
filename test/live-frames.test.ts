/**
 * What a phone watching a working session is sent. A real server runs in a temporary folder with a faux model that
 * streams a long answer, and two clients read its event stream as raw HTTP: one from before the run, one that joins
 * halfway. The frames are counted, their bytes are summed, and each client's screen is rebuilt by `withEvent`.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { ClientBlock, ServerEvent } from "../shared/protocol.ts";
import { START, withEvent } from "../web/src/lib/conversation-state.ts";
import { ANSWER, THINKING } from "./fixtures/faux-streaming-model.ts";

const REPO = join(import.meta.dirname, "..");
/** `LIVE_FRAME_MS` in `server/main.ts`. */
const WINDOW_MS = 250;
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

/** A real server in a temporary folder, with a faux model that streams a long answer, and nothing else. */
async function sandboxServer(): Promise<{ base: string; cwd: string }> {
    const root = await mkdtemp(join(tmpdir(), "live-frames-"));
    const cwd = join(root, "cwd");

    roots.push(root);
    await mkdir(join(cwd, "extensions", "fauxmodel"), { recursive: true });
    await symlink(
        join(REPO, "test", "fixtures", "faux-streaming-model.ts"),
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

    return { base: `http://127.0.0.1:${String(port)}`, cwd };
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

function eventOf(frame: string): ServerEvent {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the server wrote this JSON
    return JSON.parse(frame) as ServerEvent;
}

type Frame = { at: number; bytes: number; event: ServerEvent };

type Watch = { frames: Frame[]; stop: () => void };

/** One conversation stream read as plain bytes, so a frame's size is what the phone is sent. */
function watch(base: string, session: number): Watch {
    const started = performance.now();
    const frames: Frame[] = [];
    const request = httpGet(`${base}/api/events?session=${String(session)}`);
    let buffered = "";

    request.on("response", (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
            const parts = (buffered + chunk).split("\n\n");

            buffered = parts.pop() ?? "";

            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.slice(6);

                    frames.push({
                        at: performance.now() - started,
                        bytes: Buffer.byteLength(data),
                        event: eventOf(data),
                    });
                }
            }
        });
    });
    request.on("error", () => undefined);

    return {
        frames,
        stop: () => {
            request.destroy();
        },
    };
}

async function until(what: string, ready: () => boolean, within: number): Promise<void> {
    for (const end = performance.now() + within; performance.now() < end;) {
        if (ready()) {
            return;
        }

        await delay(20);
    }

    assert.fail(`${what} did not happen within ${String(within)} ms`);
}

const textOf = (blocks: readonly ClientBlock[] | undefined, type: "text" | "thinking"): string =>
    blocks?.flatMap((block) => (block.type === type ? [block.text] : [])).join("") ?? "";

const liveOf = (frames: readonly Frame[]) =>
    frames.flatMap(({ event }) => (event.type === "live" ? [event.live] : []));

/** The run is over for a stream once a frame says the agent stopped, after one said it worked. */
const ended = (frames: readonly Frame[]): boolean => {
    const lives = liveOf(frames);
    const started = lives.findIndex((live) => live.busy);

    return started !== -1 && lives.slice(started).some((live) => !live.busy);
};

/** Every state a screen passes through, with `withEvent`, and the last one. */
function replay(frames: readonly Frame[]) {
    let state = START;
    const screens: (typeof START)[] = [];

    for (const { event } of frames) {
        state = withEvent(state, event);
        screens.push(state);
    }

    return { screens, state };
}

type Run = { early: Watch; joined: Watch; joinedAfter: number };

let run: Run;

before(async () => {
    const { base, cwd } = await sandboxServer();
    const created = await post(base, "/api/sessions", { cwd });

    assert.ok(typeof created === "object" && created !== null, "a session was created");

    const session = Number(Reflect.get(created, "session"));
    const early = watch(base, session);

    await until("the hello", () => early.frames.length > 0, 5000);
    await post(base, "/api/messages", { session, text: "go" });

    // The second client comes when the answer has grown a while: what it is sent must carry on from its hello.
    await until(
        "a dozen live frames",
        () => early.frames.filter(({ event }) => event.type === "live").length >= 12,
        20_000,
    );

    const joined = watch(base, session);
    const joinedAfter = early.frames.length;

    await until("the run to end", () => ended(early.frames) && ended(joined.frames), 20_000);
    early.stop();
    joined.stop();
    run = { early, joined, joinedAfter };
});

after(async () => {
    for (const child of running) {
        child.kill("SIGKILL");
    }

    for (const root of roots) {
        await rm(root, { recursive: true, force: true });
    }
});

void describe("the live frames of a working session", () => {
    void it("come once per window, and the last one says the agent stopped", () => {
        const { frames } = run.early;
        const lives = frames.filter(({ event }) => event.type === "live");
        const entries = frames.filter(({ event }) => event.type === "entries").length;
        const first = lives[0];
        const last = lives.at(-1);

        assert.ok(first !== undefined && last?.event.type === "live");
        assert.equal(last.event.live.busy, false, "the end of the run is not swallowed");

        const span = last.at - first.at;
        // One for the first token and one for each entry that comes with its own, which cannot wait.
        const allowed = Math.floor(span / WINDOW_MS) + 1 + entries + 1;

        assert.ok(
            lives.length <= allowed,
            `${String(lives.length)} live frames in ${span.toFixed(0)} ms, at most ${String(allowed)} expected`,
        );
    });

    void it("rebuild the answer a client holds, never wrong and never short", () => {
        const { screens, state } = replay(run.early.frames);
        let longest = 0;

        for (const { live } of screens) {
            const answer = textOf(live.blocks, "text");
            const thinking = textOf(live.blocks, "thinking");

            assert.ok(ANSWER.startsWith(answer), "the streamed answer is a start of the real one");
            assert.ok(
                THINKING.startsWith(thinking),
                "the streamed thinking is a start of the real one",
            );
            longest = Math.max(longest, answer.length);
        }

        const committed = state.entries.findLast((entry) => entry.kind === "assistant");

        assert.equal(textOf(committed?.blocks, "text"), ANSWER, "the committed answer is whole");
        assert.ok(
            longest > ANSWER.length / 2,
            `the streamed answer reached ${String(longest)} characters`,
        );
        assert.equal(
            state.live.blocks,
            undefined,
            "the run's last frame leaves no streamed answer",
        );
    });

    void it("rebuild it for a client that joined halfway too", () => {
        const { screens } = replay(run.joined.frames);
        const hello = screens[0];
        const early = replay(run.early.frames).screens.map(({ live }) =>
            textOf(live.blocks, "text"),
        );

        assert.ok(
            textOf(hello?.live.blocks, "text").length > 0,
            "the hello carried a part of the answer",
        );

        for (const { live } of screens) {
            assert.ok(ANSWER.startsWith(textOf(live.blocks, "text")), "a start of the real answer");
        }

        const held = textOf(hello?.live.blocks, "text").length;
        const afterHello = run.joined.frames
            .slice(1)
            .reduce((sum, { event, bytes }) => (event.type === "live" ? sum + bytes : sum), 0);
        // What came after the hello is the rest of the answer and the framing of each frame, not the answer again.
        const bound = ANSWER.length - held + 8000;

        assert.ok(
            afterHello < bound,
            `${String(afterHello)} bytes after the hello, under ${String(bound)} expected`,
        );

        const lastWith = (texts: string[]): string =>
            texts.filter((text) => text !== "").at(-1) ?? "";
        const joined = screens.map(({ live }) => textOf(live.blocks, "text"));

        assert.equal(
            lastWith(joined),
            lastWith(early),
            "both clients end with the same streamed answer",
        );
    });

    void it("grow with what is new, not with what was already sent", () => {
        const sent = run.early.frames.reduce(
            (sum, { event, bytes }) => (event.type === "live" ? sum + bytes : sum),
            0,
        );

        // Measured: the answer and its thinking once plus JSON framing is about 1.06 times their length; a whole
        // block in every frame was 8.5 times (one frame per commit, 20 times).
        const bound = 2 * (ANSWER.length + THINKING.length);

        assert.ok(
            sent < bound,
            `${String(sent)} bytes of live frames, under ${String(bound)} expected`,
        );
    });
});
