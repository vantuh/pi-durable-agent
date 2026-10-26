import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sessionFromSearch } from "../web/src/lib/deep-link.ts";

void describe("sessionFromSearch", () => {
    void it("reads a positive integer", () => {
        assert.equal(sessionFromSearch("?session=42"), 42);
        assert.equal(sessionFromSearch("?x=1&session=7"), 7);
    });

    void it("ignores anything else", () => {
        for (const search of [
            "",
            "?session=",
            "?session=0",
            "?session=-3",
            "?session=1.5",
            "?session=1e3",
            "?session=abc",
            "?session=07",
            "?session=99999999999999999999",
        ]) {
            assert.equal(sessionFromSearch(search), undefined, search);
        }
    });
});
