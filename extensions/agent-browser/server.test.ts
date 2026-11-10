import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { evaluate, refOf, viewportArgs } from "./server.ts";
import { run } from "./server/cli.ts";
import { messagesOf } from "./web/input.ts";

void describe("agent-browser arguments", () => {
    void it("reads refs however Pi writes them", () => {
        for (const given of ["e12", "[e12]", "[ref=e12]", "@e12"]) {
            assert.equal(refOf(given), "@e12");
        }
    });

    void it("reads presets and WIDTHxHEIGHT, and clamps sizes", () => {
        assert.deepEqual(viewportArgs("mobile"), ["390", "844", "2"]);
        assert.deepEqual(viewportArgs("1024x768"), ["1024", "768", "1"]);
        assert.deepEqual(viewportArgs("9999x10"), ["3840", "240", "1"]);
        assert.equal(viewportArgs("huge"), undefined);
    });
});

void describe("agent-browser panel input", () => {
    void it("types characters and sends keys Chrome acts on with their key codes", () => {
        assert.deepEqual(messagesOf({ type: "key", key: "a", modifiers: 0 }), [
            { type: "input_keyboard", eventType: "char", text: "a" },
        ]);

        const [down] = messagesOf({ type: "key", key: "Backspace", modifiers: 0 });

        assert.equal(down?.["windowsVirtualKeyCode"], 8);

        const [shortcut] = messagesOf({ type: "key", key: "a", modifiers: 4 });

        assert.equal(shortcut?.["eventType"], "keyDown", "Meta+A is a shortcut, not a typed a");
        assert.deepEqual(messagesOf({ type: "key", key: "Unidentified", modifiers: 0 }), []);
    });

    void it("double-clicks as two presses counted 1 and 2", () => {
        const counts = messagesOf({ type: "click", x: 1, y: 2, count: 2 })
            .filter((message) => message["eventType"] === "mousePressed")
            .map((message) => message["clickCount"]);

        assert.deepEqual(counts, [1, 2]);
    });
});

void describe("agent-browser CLI", () => {
    const session = `pda-test-${process.pid}`;

    after(async () => {
        await run(session, ["close"]).catch(() => {});
    });

    void it("runs a body that returns, and clicks a ref from a snapshot", async () => {
        await run(session, [
            "open",
            "data:text/html,<button onclick=document.title='clicked'>Go</button>",
        ]);
        assert.equal(await evaluate(session, "const a = 1;\nreturn a + 1;"), "2");

        const outline = String((await run(session, ["snapshot", "-c"]))["snapshot"]);
        const ref = /button "Go" \[ref=(e\d+)\]/.exec(outline)?.[1];

        assert.ok(ref !== undefined, outline);
        await run(session, ["click", refOf(ref)]);
        assert.equal(await evaluate(session, "document.title"), "clicked");
    });

    void it("throws what agent-browser refused", async () => {
        await assert.rejects(run(session, ["click", "@e999"]), /Unknown ref/);
    });
});
