import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate as flush } from "node:timers/promises";

import { Gate } from "./gate.ts";

const open = { abortSignal: undefined };

/** Starts a hold without waiting for it, and says whether it has finished. */
function started(hold: Promise<void>): () => boolean {
    let done = false;

    void (async () => {
        await hold;
        done = true;
    })();

    return () => done;
}

void describe("pause gate", () => {
    void it("holds nothing while the gate is open", async () => {
        const gate = new Gate();
        const through = started(gate.hold(open));

        await flush();

        assert.equal(through(), true);
    });

    void it("parks a call until a resume lets it through", async () => {
        const gate = new Gate();
        gate.pause();
        const through = started(gate.hold(open));

        await flush();
        assert.equal(through(), false);

        gate.resume();
        await flush();
        assert.equal(through(), true);
        assert.equal(gate.paused, false);
    });

    void it("parks every call of the same conversation, and opens them together", async () => {
        const gate = new Gate();
        gate.pause();
        const first = started(gate.hold(open));
        const second = started(gate.hold(open));

        await flush();
        assert.deepEqual([first(), second()], [false, false]);

        gate.resume();
        await flush();
        assert.deepEqual([first(), second()], [true, true]);
    });

    void it("releases a parked call on abort, so a stop never waits on the gate", async () => {
        const gate = new Gate();
        const controller = new AbortController();
        gate.pause();
        const through = started(gate.hold({ abortSignal: controller.signal }));

        await flush();
        assert.equal(through(), false);

        controller.abort();
        await flush();
        assert.equal(through(), true);
    });

    void it("does not park another conversation", async () => {
        const held = new Gate();
        const other = new Gate();
        held.pause();
        const through = started(held.hold(open));

        await other.hold(open);
        await flush();

        assert.equal(through(), false);
        held.resume();
    });
});
