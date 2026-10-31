import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ThemedToken } from "shiki";

import { classOf, load, tokensOf } from "../web/src/lib/highlight.ts";

const token = (color: string, fontStyle?: number): ThemedToken => ({
    content: "x",
    offset: 0,
    color,
    ...(fontStyle === undefined ? {} : { fontStyle }),
});

void describe("tokensOf", () => {
    void it("returns lines of tokens for a known language, whatever its case", async () => {
        const lines = await tokensOf("const a = 1;\nlet b;", "TS");

        assert.equal(lines?.length, 2);
        assert.equal(lines?.[0]?.map((each) => each.content).join(""), "const a = 1;");
        assert.ok(lines?.[0]?.some((each) => each.color === "var(--shiki-token-keyword)"));
    });

    void it("returns undefined for an unknown language or none, so the code stays plain", async () => {
        assert.equal(await tokensOf("hello", "not-a-language"), undefined);
        assert.equal(await tokensOf("hello", "constructor"), undefined);
        assert.equal(await tokensOf("hello", ""), undefined);
    });

    void it("creates the highlighter once for concurrent and later calls", async () => {
        const first = load();
        await Promise.all([tokensOf("a", "js"), tokensOf("b", "json")]);

        assert.equal(load(), first);
    });
});

void describe("classOf", () => {
    void it("maps a token colour to its role class, and an unknown colour to plain ink", () => {
        assert.equal(classOf(token("var(--shiki-token-keyword)")), "text-code-keyword");
        assert.equal(classOf(token("var(--shiki-token-deleted)")), "text-danger");
        assert.equal(classOf(token("#ff0000")), "text-ink");
    });

    void it("adds italic and semibold from the font style bits", () => {
        assert.equal(classOf(token("var(--shiki-token-comment)", 1)), "text-code-comment italic");
        assert.equal(
            classOf(token("var(--shiki-token-function)", 2)),
            "text-code-function font-semibold",
        );
        assert.equal(
            classOf(token("var(--shiki-token-string)", 3)),
            "text-code-string italic font-semibold",
        );
    });
});
