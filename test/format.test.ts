// Test: the one rendering of a token count and of a price the browser shows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cost, tokens } from "../web/src/lib/format.ts";

void describe("tokens", () => {
    void it("says a count under a thousand exactly, and rounds a fraction up to it", () => {
        assert.equal(tokens(0), "0");
        assert.equal(tokens(947), "947");
        assert.equal(tokens(999), "999");
        assert.equal(tokens(-5), "0");
        assert.equal(tokens(999.6), "1k");
    });

    void it("gives one decimal of k under ten thousand, then whole k", () => {
        assert.equal(tokens(1000), "1k");
        assert.equal(tokens(1500), "1.5k");
        assert.equal(tokens(9999), "10k");
        assert.equal(tokens(10_000), "10k");
        assert.equal(tokens(45_678), "46k");
        assert.equal(tokens(250_000), "250k");
    });

    void it("rounds into millions rather than printing a thousand k", () => {
        assert.equal(tokens(999_499), "999k");
        assert.equal(tokens(999_999), "1M");
        assert.equal(tokens(1_000_000), "1M");
        assert.equal(tokens(1_500_000), "1.5M");
        assert.equal(tokens(1_048_576), "1M");
    });
});

void describe("cost", () => {
    void it("says nothing spent as zero, and keeps the fractions under a dollar", () => {
        assert.equal(cost(0), "$0");
        assert.equal(cost(0.0042), "$0.004");
        assert.equal(cost(0.5), "$0.500");
    });

    void it("gives cents from a dollar up", () => {
        assert.equal(cost(1), "$1.00");
        assert.equal(cost(1.5), "$1.50");
        assert.equal(cost(12.345), "$12.35");
    });
});
