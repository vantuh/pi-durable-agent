import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { setTimeout } from "node:timers/promises";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitListener, CommitView, Host } from "../../server/sdk.ts";
import { due, IDLE_STOP, LEAD, TTL } from "./due.ts";
import keepWarm, { actions } from "./server.ts";
import { readStore } from "./store.ts";
import {
    activityOf,
    cached,
    lastRequestOf,
    nextOf,
    observe,
    open,
    stopped,
    warming,
    type Seen,
} from "./warm.ts";

const now = Date.parse("2026-10-24T12:00:00Z");
const minutes = (count: number) => count * 60_000;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written entry, without the harness that brands its ids
const entry = (value: object): EntryRecord => value as unknown as EntryRecord;
const asked = (id: number, text: string, timestamp: number): EntryRecord =>
    entry({
        id,
        conversationId: id,
        kind: "pi.user",
        data: { text },
        model: [{ role: "user", content: text, timestamp }],
    });
const answered = (id: number, timestamp: number): EntryRecord =>
    entry({
        id,
        conversationId: id,
        kind: "pi.assistant",
        model: [
            {
                role: "assistant",
                provider: "anthropic",
                model: "opus",
                stopReason: "stop",
                timestamp,
                usage: { cacheRead: 1_000, cacheWrite: 0 },
                content: [],
            },
        ],
    });

void test("pings in the last minutes of the cache hour while the user was here recently", () => {
    assert.equal(due({ now, lastRequest: now - LEAD, inputAt: now - minutes(70) }), true);
    assert.equal(due({ now, lastRequest: now - minutes(59), inputAt: now - minutes(59) }), true);
});

void test("waits while the cache is fresh and never pings a cold one", () => {
    assert.equal(due({ now, lastRequest: now - minutes(30), inputAt: now - minutes(30) }), false);
    assert.equal(due({ now, lastRequest: now - TTL, inputAt: now - minutes(61) }), false);
});

void test("stops once the user has been away 8 hours, and without any input", () => {
    assert.equal(due({ now, lastRequest: now - LEAD, inputAt: now - IDLE_STOP }), false);
    assert.equal(due({ now, lastRequest: now - LEAD }), false);
    assert.equal(due({ now, inputAt: now }), false);
});

void test("does not retry after a failed ping until a newer request", () => {
    const lastRequest = now - LEAD;
    const inputAt = now - minutes(70);

    assert.equal(due({ now, lastRequest, inputAt, failedAfter: lastRequest + 1 }), false);
    assert.equal(due({ now, lastRequest, inputAt, failedAfter: lastRequest - 1 }), true);
});

void test("counts only answers that came back from the provider with cache tokens", () => {
    const answer = (change: Record<string, unknown>): AssistantMessage => {
        const written = {
            role: "assistant",
            provider: "anthropic",
            model: "claude-opus-5-5",
            stopReason: "stop",
            timestamp: now,
            usage: { cacheRead: 500_000, cacheWrite: 2_000 },
            content: [],
            ...change,
        };

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written message, without the provider filling the rest
        return written as unknown as AssistantMessage;
    };

    assert.equal(cached(answer({})), true);
    assert.equal(cached(answer({ provider: "openai" })), false);
    assert.equal(cached(answer({ stopReason: "error" })), false);
    assert.equal(cached(answer({ stopReason: "aborted" })), false);
    assert.equal(cached(answer({ usage: { cacheRead: 0, cacheWrite: 0 } })), false);
});

void test("a commit gives the user's latest input, the newest cached answer and the run", () => {
    const seen = new Map<number, Seen>();
    const view = (entries: CommitView["entries"], busy = false): CommitView => ({
        session: { id: 7, cwd: "/work/pi-durable-agent" },
        entries,
        busy,
    });
    const user = (timestamp: number) =>
        entry({
            id: 1,
            conversationId: 7,
            kind: "pi.user",
            data: { text: "why does the fold close\nsecond line" },
            model: [{ role: "user", content: "hi", timestamp }],
        });
    const answer = (timestamp: number, change: Record<string, unknown> = {}) =>
        entry({
            id: 2,
            conversationId: 7,
            kind: "pi.assistant",
            model: [
                {
                    role: "assistant",
                    provider: "anthropic",
                    model: "claude-opus-5-5",
                    stopReason: "stop",
                    timestamp,
                    usage: { cacheRead: 1_000, cacheWrite: 0 },
                    content: [],
                    ...change,
                },
            ],
        });

    observe(seen, view([user(now - minutes(10)), answer(now - minutes(9))]));
    assert.deepEqual(seen.get(7), {
        inputAt: now - minutes(10),
        cached: { at: now - minutes(9), model: "claude-opus-5-5" },
        label: "pi-durable-agent",
        busy: false,
    });

    // A failed answer renews nothing: the older cached one stays.
    observe(
        seen,
        view([user(now - minutes(5)), answer(now - minutes(4), { stopReason: "error" })], true),
    );
    assert.deepEqual(seen.get(7), {
        inputAt: now - minutes(5),
        cached: { at: now - minutes(9), model: "claude-opus-5-5" },
        label: "pi-durable-agent",
        busy: true,
    });

    // The folder is all this layer knows: the name a person reads comes from the core, through sessionTitle.
    observe(seen, { session: { id: 8, cwd: "/work/other" }, entries: [], busy: false });
    assert.equal(seen.get(8)?.label, "other");
});

void test("lists the conversations a ping is coming for, the one asked last first", () => {
    const seen = new Map<number, Seen>([
        [
            1,
            {
                inputAt: now - minutes(70),
                cached: { at: now - minutes(56), model: "opus" },
                label: "older question",
                busy: false,
            },
        ],
        [
            2,
            {
                inputAt: now - IDLE_STOP,
                cached: { at: now - minutes(56), model: "opus" },
                label: "away too long",
                busy: false,
            },
        ],
        [
            3,
            {
                inputAt: now - minutes(5),
                cached: { at: now - minutes(4), model: "opus" },
                label: "newer question",
                busy: false,
            },
        ],
        // A ping failed after the last answer: no next one until a newer answer.
        [
            4,
            {
                inputAt: now - minutes(5),
                cached: { at: now - minutes(56), model: "opus" },
                label: "after a failure",
                busy: false,
            },
        ],
        // Nothing ever renewed the cache here.
        [5, { inputAt: now - minutes(5), label: "nothing cached", busy: false }],
    ]);
    const stored = {
        last: { "4": { at: now - minutes(50), model: "opus", error: "boom" } },
    };

    assert.deepEqual(warming(stored, seen, now), [
        { id: 3, label: "newer question", nextAt: now - minutes(4) + LEAD },
        { id: 1, label: "older question", nextAt: now - minutes(56) + LEAD },
    ]);
});

void test("stops warming the conversations the user turned off, until they write in one", () => {
    const seen = new Map<number, Seen>([
        [
            1,
            {
                inputAt: now - minutes(70),
                cached: { at: now - minutes(56), model: "opus" },
                label: "a question",
                busy: false,
            },
        ],
    ]);

    assert.equal(warming({ stop: { "1": now - minutes(60) } }, seen, now).length, 0);
    // A newer input lifts the stop: the user is back, so the hour is worth renewing again.
    assert.equal(warming({ stop: { "1": now - minutes(80) } }, seen, now).length, 1);
    assert.equal(stopped({}, 1, now), false);
});

void test("keeps the stopped conversations it reads, and drops the ones it cannot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keep-warm-"));
    await writeFile(
        join(dir, "keep-warm.json"),
        JSON.stringify({ stop: { "3": 1_700, "4": "soon" }, last: {} }),
    );

    assert.deepEqual(await readStore(dir), { stop: { "3": 1_700 } });
    await rm(dir, { recursive: true, force: true });
});

void test("a ping counts as the last request only when it succeeded on this model", () => {
    const seen: Seen = {
        inputAt: now,
        cached: { at: now - minutes(60), model: "opus" },
        label: "a question",
        busy: false,
    };

    assert.equal(
        lastRequestOf(seen, { at: now - minutes(5), model: "opus" }, "opus"),
        now - minutes(5),
    );
    // Another model's cache is another cache: nothing on "sonnet" was renewed.
    assert.equal(lastRequestOf(seen, { at: now - minutes(5), model: "opus" }, "sonnet"), undefined);
    assert.equal(
        lastRequestOf(seen, { at: now - minutes(5), model: "opus", error: "boom" }, "opus"),
        now - minutes(60),
    );
    assert.equal(lastRequestOf({ label: "x", busy: false }, undefined, "opus"), undefined);
});

void test("shows the next ping only when one will really run", () => {
    const lastRequest = now - LEAD;
    const lead = lastRequest + LEAD;

    assert.equal(nextOf({ now: now - minutes(10), lastRequest, inputAt: now - minutes(70) }), lead);
    assert.equal(nextOf({ now, lastRequest, inputAt: now - minutes(70) }), lead);
    assert.equal(nextOf({ now, lastRequest, inputAt: now - IDLE_STOP }), undefined);
    assert.equal(
        nextOf({ now, lastRequest, inputAt: now - minutes(70), failedAfter: lastRequest + 1 }),
        undefined,
    );
});

void test("reads a conversation's last request and failure from the state it was given", () => {
    const seen: Seen = {
        inputAt: now - minutes(5),
        cached: { at: now - minutes(56), model: "opus" },
        label: "a question",
        busy: false,
    };
    const stored = { last: { "7": { at: now - minutes(1), model: "opus", error: "boom" } } };

    assert.deepEqual(activityOf(stored, 7, seen, "opus", now), {
        now,
        lastRequest: now - minutes(56),
        inputAt: now - minutes(5),
        failedAfter: now - minutes(1),
        last: { at: now - minutes(1), model: "opus", error: "boom" },
    });
    assert.deepEqual(activityOf({}, 7, undefined, "opus", now), { now });
});

void test("sends only while on, idle and within the hour", () => {
    const lastRequest = now - minutes(30);

    assert.equal(open(false, false, lastRequest, now), true);
    assert.equal(open(true, false, lastRequest, now), false);
    assert.equal(open(false, true, lastRequest, now), false);
    assert.equal(open(false, false, now - TTL, now), false);
});

void test("names the warmed conversations with the titles the core keeps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keep-warm-"));
    const commits: CommitListener[] = [];
    const disposers: (() => void | Promise<void>)[] = [];
    const host: Host = {
        name: "keep-warm",
        cwd: dir,
        dataDir: dir,
        log: () => undefined,
        onCommit: (listener) => {
            commits.push(listener);
        },
        onDispose: (dispose) => {
            disposers.push(dispose);
        },
        shapeModelRequests: () => undefined,
        registerModelProvider: () => () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionRequest: () => Promise.resolve(undefined),
        // Session 3 has no title yet, so the folder the commits alone name it by has to stand.
        sessionTitle: (session) => Promise.resolve(session === 2 ? "mcp plugin" : null),
        sessionName: () => Promise.resolve(null),
        setSessionTitle: () => Promise.resolve(),
        setSessionMark: () => undefined,
    };
    const at = Date.now();

    // The timer outlives a failed assertion, so it has to be cleared even then.
    try {
        await keepWarm(host);
        await commits[0]?.({
            session: { id: 2, cwd: "/work/mcp" },
            entries: [
                asked(2, "how do I plug mcp in", at - minutes(10)),
                answered(2, at - minutes(9)),
            ],
            busy: false,
        });
        await commits[0]?.({
            session: { id: 3, cwd: "/work/other" },
            entries: [asked(3, "a renamed one", at - minutes(10)), answered(3, at - minutes(9))],
            busy: false,
        });

        const state: unknown = await actions(host)["state"]?.({
            args: undefined,
            session: { id: 2, cwd: "/work/mcp" },
        });

        assert.deepEqual(state, {
            on: true,
            sessions: [
                { id: 2, label: "mcp plugin", nextAt: at - minutes(9) + LEAD },
                { id: 3, label: "other", nextAt: at - minutes(9) + LEAD },
            ],
        });
    } finally {
        for (const dispose of disposers) {
            await dispose();
        }

        await rm(dir, { recursive: true, force: true });
    }
});

void test("forgets a conversation nothing can be sent to, so the popover stops promising a ping", async () => {
    // The tick's minute is fired by hand: waiting for it is the one thing a test cannot do.
    mock.timers.enable({ apis: ["setInterval"] });
    const dir = await mkdtemp(join(tmpdir(), "keep-warm-"));
    const commits: CommitListener[] = [];
    const disposers: (() => void | Promise<void>)[] = [];
    const host: Host = {
        name: "keep-warm",
        cwd: dir,
        dataDir: dir,
        log: () => undefined,
        onCommit: (listener) => {
            commits.push(listener);
        },
        onDispose: (dispose) => {
            disposers.push(dispose);
        },
        shapeModelRequests: () => undefined,
        registerModelProvider: () => () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        // Deleted: the core refuses to build a request for it, so no ping can be sent.
        sessionRequest: () => Promise.resolve(undefined),
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        setSessionTitle: () => Promise.resolve(),
        setSessionMark: () => undefined,
    };
    const at = Date.now();
    const sessions = async (): Promise<unknown> =>
        await actions(host)["state"]?.({ args: undefined, session: null });

    try {
        await keepWarm(host);
        await commits[0]?.({
            session: { id: 4, cwd: "/work/mcp" },
            entries: [
                asked(4, "how do I plug mcp in", at - minutes(10)),
                answered(4, at - minutes(9)),
            ],
            busy: false,
        });

        // The list is built from the commits alone, so it promises a ping before the tick has looked.
        assert.deepEqual(await sessions(), {
            on: true,
            sessions: [{ id: 4, label: "mcp", nextAt: at - minutes(9) + LEAD }],
        });

        mock.timers.tick(60_000);
        await setTimeout(50);

        assert.deepEqual(await sessions(), { on: true, sessions: [] }, "the row is gone");
    } finally {
        mock.timers.reset();

        for (const dispose of disposers) {
            await dispose();
        }

        await rm(dir, { recursive: true, force: true });
    }
});

void test("builds no request for a conversation the user left too long ago for a ping", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    const dir = await mkdtemp(join(tmpdir(), "keep-warm-"));
    const commits: CommitListener[] = [];
    const disposers: (() => void | Promise<void>)[] = [];
    const built: number[] = [];
    const host: Host = {
        name: "keep-warm",
        cwd: dir,
        dataDir: dir,
        log: () => undefined,
        onCommit: (listener) => {
            commits.push(listener);
        },
        onDispose: (dispose) => {
            disposers.push(dispose);
        },
        shapeModelRequests: () => undefined,
        registerModelProvider: () => () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionRequest: (session) => {
            built.push(session);

            return Promise.resolve(undefined);
        },
        sessionTitle: () => Promise.resolve(null),
        sessionName: () => Promise.resolve(null),
        setSessionTitle: () => Promise.resolve(),
        setSessionMark: () => undefined,
    };
    const at = Date.now();

    try {
        await keepWarm(host);
        await commits[0]?.({
            session: { id: 5, cwd: "/work/old" },
            entries: [asked(5, "long ago", at - IDLE_STOP - minutes(1))],
            busy: false,
        });
        await commits[0]?.({
            session: { id: 6, cwd: "/work/recent" },
            entries: [asked(6, "just now", at - minutes(1))],
            busy: false,
        });

        mock.timers.tick(60_000);
        await setTimeout(50);

        assert.deepEqual(built, [6]);
    } finally {
        mock.timers.reset();

        for (const dispose of disposers) {
            await dispose();
        }

        await rm(dir, { recursive: true, force: true });
    }
});
