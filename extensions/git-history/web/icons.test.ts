import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

void describe("the icon subset", () => {
    // A mark missing from the font draws an empty box, and a glyph kept but unused is dead weight:
    // the command in the docs is what rebuilds assets/icons.woff2, so it names exactly the used codepoints.
    void it("is built from the marks icons.tsx asks for", async () => {
        const source = await read("./icons.tsx");
        const used = [...source.matchAll(/\\u\{?([0-9a-f]{4,6})\}?/g)].map((match) =>
            Number.parseInt(match[1] ?? "", 16),
        );
        const documented = await read("../README.md");
        const listed = (/--unicodes=([0-9a-f,]+)/.exec(documented)?.[1] ?? "")
            .split(",")
            .map((codepoint) => Number.parseInt(codepoint, 16));

        assert.ok(used.length > 20, "the marks should still be there");
        assert.deepEqual(
            [...used].sort((a, b) => a - b),
            listed.sort((a, b) => a - b),
        );
    });
});
