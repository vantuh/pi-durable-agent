import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { insert, type Field } from "./insert.ts";

function box(value: string, at = value.length, end = at): Field {
    return { value, selectionStart: at, selectionEnd: end };
}

void describe("insert", () => {
    void it("words go in at the caret, with a space only where words would touch", () => {
        const { value, at } = insert(box("Fix the now", 7), "bug");

        assert.equal(value, "Fix the bug now");
        assert.equal(at, 11, "the caret stays after the words");
    });

    void it("a sentence's first word starts with a capital", () => {
        assert.deepEqual(insert(box(""), "hello world"), { value: "Hello world", at: 11 });
        assert.equal(insert(box("Done. "), "hello world").value, "Done. Hello world");
    });

    void it("a word already in a sentence keeps its case", () => {
        assert.equal(insert(box("Pi "), "runs here").value, "Pi runs here");
    });

    void it("a selection is replaced, and nothing is added before the punctuation that follows", () => {
        const { value } = insert(box("Fix the login bug, please", 8, 17), "logout bug");

        assert.equal(value, "Fix the logout bug, please");
    });

    void it("words at the end of a full box are separated by one space", () => {
        assert.equal(insert(box("All set"), "ship it").value, "All set ship it");
    });
});
