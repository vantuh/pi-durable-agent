import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { liveWindow } from "../server/live-window.ts";

const WINDOW_MS = 60;

function windowed() {
    const sent: { session: number; at: number }[] = [];
    const started = performance.now();
    const frames = liveWindow({
        windowMs: WINDOW_MS,
        send: (session) => {
            sent.push({ session, at: performance.now() - started });
        },
    });

    return { frames, sent };
}

void describe("the live window", () => {
    void it("sends the first change at once and the rest of a burst as one send at the window's end", async () => {
        const { frames, sent } = windowed();

        for (let change = 0; change < 8; change += 1) {
            frames.changed(1);
            await delay(5);
        }

        assert.equal(sent.length, 1, "only the leading send has gone out inside the window");
        await delay(WINDOW_MS);
        frames.dispose();
        assert.equal(sent.length, 2, "the changes inside the window became one more send");
        assert.ok(
            (sent[1]?.at ?? 0) >= WINDOW_MS - 5,
            "and it waited for the window to end, not for the next change",
        );
    });

    void it("sends a change that comes after a quiet window at once", async () => {
        const { frames, sent } = windowed();

        frames.changed(1);
        await delay(WINDOW_MS + 20);
        frames.changed(1);
        frames.dispose();
        assert.equal(sent.length, 2);
    });

    void it("keeps one window per session", () => {
        const { frames, sent } = windowed();

        frames.changed(1);
        frames.changed(2);
        frames.dispose();
        assert.deepEqual(
            sent.map(({ session }) => session),
            [1, 2],
        );
    });

    void it("sends a flush now and drops the send that was waiting", async () => {
        const { frames, sent } = windowed();

        frames.changed(1);
        frames.changed(1);
        frames.flush(1);
        await delay(WINDOW_MS + 20);
        frames.dispose();
        assert.equal(sent.length, 2, "the leading send and the flush; the waiting one is gone");
    });

    void it("sends nothing more for a session that was forgotten, and for none after dispose", async () => {
        const { frames, sent } = windowed();

        frames.changed(1);
        frames.changed(1);
        frames.changed(2);
        frames.changed(2);
        frames.forget(1);
        await delay(WINDOW_MS + 20);
        assert.deepEqual(
            sent.map(({ session }) => session),
            [1, 2, 2],
            "session 1 lost its waiting send, session 2 kept its own",
        );
        frames.changed(2);
        frames.changed(2);
        frames.dispose();
        await delay(WINDOW_MS + 20);
        assert.equal(sent.length, 3);
    });
});
