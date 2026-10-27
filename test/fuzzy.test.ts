import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fuzzyMatch, fuzzyScore, segments } from "../web/src/lib/fuzzy.ts";

void describe("fuzzyScore", () => {
    void it("matches everything on an empty query", () => {
        assert.equal(fuzzyScore("Anything", ""), 0);
        assert.equal(fuzzyScore("Anything", "   "), 0);
    });

    void it("matches a substring, case aside", () => {
        assert.notEqual(fuzzyScore("Fix login button", "LOGIN"), null);
    });

    void it("matches letters that come in order, adjacent ones scoring higher", () => {
        const near = fuzzyScore("fx button", "fx");
        const far = fuzzyScore("f x button", "fx");

        assert.notEqual(near, null);
        assert.notEqual(far, null);
        assert.ok(near !== null && far !== null && near > far);
    });

    void it("rejects letters out of order", () => {
        assert.equal(fuzzyScore("Fix login button", "nigol"), null);
        assert.equal(fuzzyScore("Fix login button", "zzz"), null);
    });

    void it("ranks a word start above a match in the middle", () => {
        const start = fuzzyScore("login fix", "fix");
        const middle = fuzzyScore("prefixlogin", "fix");

        assert.ok(start !== null && middle !== null && start > middle);
    });

    void it("needs every word of the query, in any order", () => {
        assert.notEqual(fuzzyScore("Fix login button", "log fix"), null);
        assert.equal(fuzzyScore("Fix login button", "log fix deploy"), null);
    });
});

void describe("fuzzyMatch ranges", () => {
    void it("points at the substring it found", () => {
        assert.deepEqual(fuzzyMatch("Fix login", "login")?.ranges, [[4, 9]]);
    });

    void it("merges neighbouring letters into one range", () => {
        assert.deepEqual(fuzzyMatch("fx button", "fx")?.ranges, [[0, 2]]);
    });

    void it("marks each letter of a spread-out match", () => {
        assert.deepEqual(fuzzyMatch("fix button", "fbtn")?.ranges, [
            [0, 1],
            [4, 5],
            [6, 7],
            [9, 10],
        ]);
    });

    void it("marks nothing for an empty query", () => {
        assert.deepEqual(fuzzyMatch("Fix login", "")?.ranges, []);
    });
});

void describe("segments", () => {
    void it("cuts the title at the ranges, hits apart from the rest", () => {
        assert.deepEqual(segments("Fix login", fuzzyMatch("Fix login", "log")?.ranges ?? []), [
            { text: "Fix ", hit: false },
            { text: "log", hit: true },
            { text: "in", hit: false },
        ]);
    });

    void it("returns the whole title untouched when nothing matched", () => {
        assert.deepEqual(segments("Fix login", []), [{ text: "Fix login", hit: false }]);
    });

    void it("returns one hit when the whole title matched", () => {
        assert.deepEqual(segments("fix", fuzzyMatch("fix", "fix")?.ranges ?? []), [
            { text: "fix", hit: true },
        ]);
    });
});
