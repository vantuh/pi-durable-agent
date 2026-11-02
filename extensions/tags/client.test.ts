// Test: which answer the browser keeps when a read and a change are out at the same time.
// Run: pnpm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { load, snapshot, toggleTag } from "./client.ts";
import type { TagsState } from "./refs.ts";

type Call = (answer: unknown) => void;

/** Every call the store makes, held until the test answers it: the order of the answers is the test. */
const calls: Call[] = [];

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for fetch: the test answers each call itself
globalThis.fetch = (async () =>
    await new Promise((resolve) => {
        calls.push(resolve);
    })) as unknown as typeof fetch;

function answer(at: number, result: TagsState): void {
    const call = calls[at];
    assert.ok(call, `no call at ${String(at)}`);
    call({ ok: true, json: () => Promise.resolve({ result }) });
}

function refuse(at: number, message: string): void {
    const call = calls[at];
    assert.ok(call, `no call at ${String(at)}`);
    call({ ok: false, status: 400, json: () => Promise.resolve({ error: message }) });
}

const held = (...ids: string[]): TagsState => ({
    tags: ids.map((id) => ({ id, name: id.toUpperCase() })),
    sessions: { "7": ids },
});

void test("an answer that was overtaken never lands on top", async () => {
    // 0 is a read, 1 the change; the change answers first, so the read must not replace it.
    const reading = load();
    const changing = toggleTag("a", 7);
    assert.equal(calls.length, 2);

    answer(1, held("a"));
    await changing;
    assert.deepEqual(snapshot(), held("a"));

    answer(0, held());
    await reading;
    assert.deepEqual(snapshot(), held("a"));

    // 2 and 3 are two changes; the newer one fails, so the older answer is dropped and read back.
    const first = toggleTag("b", 7);
    const second = toggleTag("c", 7);

    refuse(3, "no such tag");
    await assert.rejects(second, /no such tag/u);

    answer(2, held("a", "b"));
    await first;
    assert.deepEqual(snapshot(), held("a"), "an answer older than the failed change is not shown");

    // The failure sent the store back to the file: 4 is that read, and it is what shows at last.
    assert.equal(calls.length, 5);
    const readBack = load();

    answer(4, held("a", "b"));
    await readBack;
    assert.deepEqual(snapshot(), held("a", "b"));

    // A read that starts after a change was sent, but reads the file before that change landed.
    const changeAt = calls.length;
    const slow = toggleTag("d", 7);
    const readAt = calls.length;
    const after = load();
    assert.equal(readAt, changeAt + 1);

    answer(changeAt, held("a", "b", "d"));
    await slow;
    answer(readAt, held("a", "b"));
    await after;

    assert.deepEqual(snapshot(), held("a", "b", "d"), "a read older than the change is not shown");

    // A refresh already out cannot be the recovery: it is discarded too, so a fresh read follows it.
    const refreshAt = calls.length;
    const refresh = load();
    const one = toggleTag("d", 7);
    const two = toggleTag("e", 7);

    answer(refreshAt + 1, held("a", "b", "d", "f"));
    await one;

    refuse(refreshAt + 2, "no such tag");
    await assert.rejects(two, /no such tag/u);

    answer(refreshAt, held("a", "b", "d"));
    await refresh;
    await delay(0);

    const afterFailure = calls.length;
    assert.equal(afterFailure, refreshAt + 4, "the recovery read follows the discarded one");

    answer(afterFailure - 1, held("a", "b", "d", "f"));
    await load();
    assert.deepEqual(snapshot(), held("a", "b", "d", "f"));
});
