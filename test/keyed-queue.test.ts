// Test: work on one key runs one piece at a time; other keys, rejections and reloads do not disturb it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate as tick } from "node:timers/promises";

import { serialize } from "../server/keyed-queue.ts";

const QUEUES = Symbol.for("pi-durable-agent.keyed-queue");
let keys = 0;
const freshKey = (): string => `test-${String(keys++)}`;

/** A read, a pause, then a write of what was read plus one: it loses an update unless nothing overlaps. */
async function increment(box: { value: number }): Promise<void> {
    const read = box.value;

    await tick();
    box.value = read + 1;
}

void describe("serialize", () => {
    void it("keeps work on one key from overlapping", async () => {
        const key = freshKey();
        const box = { value: 0 };

        await Promise.all(Array.from({ length: 8 }, () => serialize(key, () => increment(box))));

        assert.equal(box.value, 8);
    });

    void it("runs work in the order it was queued, and gives back each result", async () => {
        const key = freshKey();
        const order: number[] = [];
        const results = await Promise.all(
            [3, 1, 2].map((each) =>
                serialize(key, async () => {
                    await tick();
                    order.push(each);

                    return each * 10;
                }),
            ),
        );

        assert.deepEqual(order, [3, 1, 2]);
        assert.deepEqual(results, [30, 10, 20]);
    });

    void it("lets work on another key run meanwhile", async () => {
        let release: () => void = () => undefined;
        const held = serialize(freshKey(), () => new Promise<void>((done) => (release = done)));
        const other = await serialize(freshKey(), () => Promise.resolve("done"));

        assert.equal(other, "done");
        release();
        await held;
    });

    void it("rejects the failed work and still runs the next on that key", async () => {
        const key = freshKey();
        const failed = serialize(key, () => Promise.reject(new Error("broken")));
        const next = serialize(key, () => Promise.resolve("after"));

        await assert.rejects(failed, /broken/);
        assert.equal(await next, "after");
        assert.equal(await serialize(key, () => Promise.resolve("later")), "later");
    });

    void it("keeps no entry for a key once its work is done", async () => {
        const key = freshKey();

        await Promise.all([
            serialize(key, () => Promise.resolve()),
            serialize(key, () => Promise.reject(new Error("broken"))).catch(() => undefined),
        ]);
        await tick();

        const held: unknown = Reflect.get(globalThis, QUEUES);

        assert.ok(held instanceof Map);
        assert.equal(held.has(key), false);
    });

    void it("shares the queue with a copy of the module loaded again, as a reload does", async () => {
        const reloaded: { serialize: typeof serialize } = await import(
            `${new URL("../server/keyed-queue.ts", import.meta.url).href}?reloaded`
        );
        const key = freshKey();
        const box = { value: 0 };

        await Promise.all([
            serialize(key, () => increment(box)),
            reloaded.serialize(key, () => increment(box)),
            serialize(key, () => increment(box)),
        ]);

        assert.equal(box.value, 3);
    });
});
