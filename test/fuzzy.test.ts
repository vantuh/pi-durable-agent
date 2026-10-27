import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fuzzyScore } from "../web/src/lib/fuzzy.ts";

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
