import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitView } from "../../server/sdk.ts";
import { due, IDLE_STOP, LEAD, TTL } from "./due.ts";
import { activityOf, cached, lastRequestOf, nextOf, observe, open, type Seen } from "./warm.ts";

const now = Date.parse("2026-10-24T12:00:00Z");
const minutes = (count: number) => count * 60_000;

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
        session: { id: 7, cwd: null },
        entries,
        busy,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written entry, without the harness that brands its ids
    const entry = (value: object) => value as unknown as EntryRecord;
    const user = (timestamp: number) =>
        entry({
            id: 1,
            conversationId: 7,
            kind: "pi.user",
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
        busy: true,
    });
});

void test("a ping counts as the last request only when it succeeded on this model", () => {
    const seen: Seen = {
        inputAt: now,
        cached: { at: now - minutes(60), model: "opus" },
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
    assert.equal(lastRequestOf({ busy: false }, undefined, "opus"), undefined);
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
