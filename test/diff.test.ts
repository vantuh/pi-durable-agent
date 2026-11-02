import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffRows, parseDiff, piecesOf, wordDiff } from "../web/src/lib/diff.ts";

// The shape `pi-durable`'s edit tool writes (`generateDiffString`): sign, padded number, space, text.
const DIFF = [
    "  9 const a = 1;",
    "-10 const name = 'old';",
    "+10 const name = 'new';",
    "+11 const extra = true;",
    " 11 export {};",
    "    ...",
].join("\n");

void describe("parseDiff", () => {
    void it("reads lines, numbers and skips, and marks the words that changed", () => {
        const lines = parseDiff(DIFF);

        assert.deepEqual(
            lines.map((line) =>
                line.type === "skip" ? "skip" : `${line.type}${String(line.num)}`,
            ),
            // The context line after one more added than removed takes the new file's number.
            ["ctx9", "del10", "add10", "add11", "ctx12", "skip"],
        );
        assert.deepEqual(lines[1]?.type !== "skip" && lines[1]?.spans, [
            { text: "const name = '", changed: false },
            { text: "old", changed: true },
            { text: "';", changed: false },
        ]);
        // The second added line has no removed line to pair with: shown whole.
        assert.deepEqual(lines[3]?.type !== "skip" && lines[3]?.spans, [
            { text: "const extra = true;", changed: false },
        ]);
    });

    void it("shows a pair with little in common whole", () => {
        assert.deepEqual(wordDiff("return a;", "throw new Error(x)"), {
            del: [{ text: "return a;", changed: false }],
            add: [{ text: "throw new Error(x)", changed: false }],
        });
    });
});

void describe("diffRows", () => {
    const shape = (diff: string): string[] =>
        diffRows(parseDiff(diff)).map((row) =>
            row.type === "skip"
                ? `skip ${row.text}`
                : `${row.left === undefined ? "-" : String(row.left.num)}|${
                      row.right === undefined ? "-" : String(row.right.num)
                  }`,
        );

    void it("pairs a change line by line, a context line on both sides with each file's number", () => {
        assert.deepEqual(shape(DIFF), ["9|9", "10|10", "-|11", "11|12", "skip ..."]);
    });

    void it("leaves the longer side of a change unpaired", () => {
        assert.deepEqual(shape(["-1 a;", "-2 b;", "+1 c;"].join("\n")), ["1|1", "2|-"]);
    });
});

void describe("piecesOf", () => {
    void it("cuts the changed spans where the highlighted tokens begin and end", () => {
        const spans = [
            { text: "let x = ", changed: false },
            { text: "old", changed: true },
            { text: ";", changed: false },
        ];
        const tokens = [
            { text: "let", className: "k" },
            { text: " x = ", className: "p" },
            { text: "old;", className: "s" },
        ];

        assert.deepEqual(piecesOf(spans, tokens), [
            { text: "let", changed: false, className: "k" },
            { text: " x = ", changed: false, className: "p" },
            { text: "old", changed: true, className: "s" },
            { text: ";", changed: false, className: "s" },
        ]);
    });

    void it("keeps the spans when the tokens spell another line", () => {
        const spans = [{ text: "a", changed: false }];

        assert.deepEqual(piecesOf(spans, [{ text: "b", className: "k" }]), spans);
    });
});
