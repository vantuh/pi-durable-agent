import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePatchFiles } from "@pierre/diffs";

import { diffCounts, editPatch } from "../web/src/lib/diff.ts";

// The shape `pi-durable`'s edit tool writes (`generateDiffString`): sign, padded number, space, text.
const DIFF = [
    "  9 const a = 1;",
    "-10 const name = 'old';",
    "+10 const name = 'new';",
    "+11 const extra = true;",
    " 11 export {};",
    "    ...",
].join("\n");

function parsed(diff: string) {
    const adapted = editPatch(diff);
    assert.ok(adapted);
    const files = parsePatchFiles(adapted.patch, undefined, true).flatMap((patch) => patch.files);
    assert.equal(files.length, 1);
    const file = files[0];
    assert.ok(file);
    return { adapted, file };
}

void describe("editPatch", () => {
    void it("preserves source text and old/new line numbers in Pierre's parser", () => {
        const { adapted, file } = parsed(DIFF);
        assert.match(adapted.patch, /@@ -9,3 \+9,4 @@/);
        assert.equal(file.type, "change");
        assert.deepEqual(file.deletionLines, [
            "const a = 1;\n",
            "const name = 'old';\n",
            "export {};\n",
        ]);
        assert.deepEqual(file.additionLines, [
            "const a = 1;\n",
            "const name = 'new';\n",
            "const extra = true;\n",
            "export {};\n",
        ]);
        assert.equal(file.hunks[0]?.deletionStart, 9);
        assert.equal(file.hunks[0]?.additionStart, 9);
        assert.deepEqual(diffCounts(DIFF), { added: 2, removed: 1 });
    });

    void it("carries the line shift across omitted context without inventing that context", () => {
        const { adapted, file } = parsed(
            "    ...\n-10 old\n+10 new\n+11 extra\n 11 after\n    ...\n 30 later\n-31 gone\n 32 end\n    ...",
        );
        assert.equal(file.hunks.length, 2);
        assert.match(adapted.patch, /@@ -10,2 \+10,3 @@/);
        assert.match(adapted.patch, /@@ -30,3 \+31,2 @@/);
        assert.equal(file.hunks[1]?.deletionStart, 30);
        assert.equal(file.hunks[1]?.additionStart, 31);
        assert.equal(file.deletionLines.length, 5);
        assert.equal(file.additionLines.length, 5);
    });

    void it("handles insertions and deletions with an empty side, including the start of a file", () => {
        for (const [diff, header, added, removed] of [
            ["+1 first\n+2 second", "@@ -0,0 +1,2 @@", 2, 0],
            ["-1 first\n-2 second", "@@ -1,2 +0,0 @@", 0, 2],
            ["    ...\n+20 inserted", "@@ -19,0 +20,1 @@", 1, 0],
            ["    ...\n-20 removed", "@@ -20,1 +19,0 @@", 0, 1],
        ] as const) {
            const { adapted, file } = parsed(diff);
            assert.ok(adapted.patch.includes(header));
            assert.equal(file.hunks[0]?.additionLines, added);
            assert.equal(file.hunks[0]?.deletionLines, removed);
        }
    });

    void it("preserves blank lines, indentation, Unicode and text resembling diff metadata", () => {
        const before = ["\tпривіт 😀  ", "", "--- old", "@@ header"];
        const after = ["\tвітаю 🦄  ", "", "+++ new", "..."];
        const diff = [
            ...before.map((line, index) => `-${String(index + 1)} ${line}`),
            ...after.map((line, index) => `+${String(index + 1)} ${line}`),
        ].join("\n");
        const { file } = parsed(diff);
        assert.deepEqual(
            file.deletionLines,
            before.map((line) => `${line}\n`),
        );
        assert.deepEqual(
            file.additionLines,
            after.map((line) => `${line}\n`),
        );
    });

    void it("keeps the server's truncation notice outside the patch, including a cut change block", () => {
        const { adapted, file } = parsed("-1 old\n-2 other\n+1 new\n … 19 more lines");
        assert.equal(adapted.note, "… 19 more lines");
        assert.equal(file.hunks[0]?.deletionLines, 2);
        assert.equal(file.hunks[0]?.additionLines, 1);
        assert.ok(!adapted.patch.includes("more lines"));
    });

    void it("rejects malformed text and inconsistent numbering instead of silently losing content", () => {
        for (const diff of [
            "",
            "    ...",
            "-1 old\nunknown",
            "-1 old\n+2 new",
            "-0 old\n+0 new",
            "-1 old\n 4 jump",
            "-10 old\n+10 new\n    ...\n-5 earlier",
            "-1 old\n\n+1 new",
            "-1 old\n … 2 more lines\n+1 new",
            "-9007199254740992 old",
        ]) {
            assert.equal(editPatch(diff), undefined, diff);
            assert.equal(diffCounts(diff), undefined, diff);
        }
    });
});
