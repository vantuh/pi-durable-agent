import assert from "node:assert/strict";
import { it } from "node:test";

import { splitStable } from "../web/src/lib/markdown-split.ts";

void it("cuts a growing reply before its last finished block", () => {
    const text = "First paragraph.\n\nSecond one.\n\nThird, still being wri";

    assert.deepEqual(splitStable(text), {
        stable: "First paragraph.\n\nSecond one.\n\n",
        tail: "Third, still being wri",
    });
});

void it("does not cut text with no block boundary", () => {
    assert.deepEqual(splitStable("one line"), { stable: "", tail: "one line" });
    assert.deepEqual(splitStable("one\nstill the same paragraph"), {
        stable: "",
        tail: "one\nstill the same paragraph",
    });
    assert.deepEqual(splitStable(""), { stable: "", tail: "" });
});

void it("does not cut at a blank line inside an open code fence", () => {
    const open = "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n\nconst c";

    assert.deepEqual(splitStable(open), {
        stable: "Intro.\n\n",
        tail: "```ts\nconst a = 1;\n\nconst b = 2;\n\nconst c",
    });
    assert.deepEqual(splitStable("~~~\na\n\nb"), { stable: "", tail: "~~~\na\n\nb" });
});

void it("cuts again once the fence is closed", () => {
    const text = "```\na\n\nb\n```\n\nAfter it.";

    assert.deepEqual(splitStable(text), { stable: "```\na\n\nb\n```\n\n", tail: "After it." });
});

void it("treats a shorter or different fence line as code, not a closing fence", () => {
    const text = "````\n```\n\n~~~\n\nstill code";

    assert.deepEqual(splitStable(text), { stable: "", tail: text });
});

void it("does not mistake inline triple backticks for a fence", () => {
    const text = "Use ```x``` here.\n\nNext";

    assert.deepEqual(splitStable(text), { stable: "Use ```x``` here.\n\n", tail: "Next" });
});

void it("does not cut inside a loose list or a quote", () => {
    const list = "Steps:\n\n1. one\n\n2. two\n\n- bullet\n\n  indented continuation";

    assert.deepEqual(splitStable(list), { stable: "", tail: list });
    assert.deepEqual(splitStable("> quoted\n\n> more"), {
        stable: "",
        tail: "> quoted\n\n> more",
    });
});

void it("always returns the whole text between the two parts", () => {
    const text = "# T\n\npara\n\n```\nx\n\ny\n```\n\n- a\n- b\n\nend";
    const { stable, tail } = splitStable(text);

    assert.equal(stable + tail, text);
    assert.equal(stable, "# T\n\npara\n\n```\nx\n\ny\n```\n\n- a\n- b\n\n");
});
