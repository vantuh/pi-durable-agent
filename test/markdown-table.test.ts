import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

/** The renderer is TSX, which `node --test` cannot strip: it is loaded the way the app loads it. */
async function renderMarkdown(text: string): Promise<string> {
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const cacheDir = await mkdtemp(join(tmpdir(), "markdown-table-vite-"));
    const server = await createServer({
        server: { middlewareMode: true, hmr: false },
        cacheDir,
        appType: "custom",
    });

    try {
        const { Markdown } = await server.ssrLoadModule("/src/ui/markdown.tsx");

        return renderToStaticMarkup(createElement(Markdown, { text }));
    } finally {
        await server.close();
        await rm(cacheDir, { recursive: true, force: true });
    }
}

const TABLE = ["| left | centre | right |", "| :--- | :----: | ----: |", "| 1 | 2 | 3 |"].join(
    "\n",
);

void describe("markdown tables", () => {
    // A table wider than a phone scrolls inside its own frame; without the box it would widen the page.
    void it("renders inside the primitive's own scroll box", async () => {
        const html = await renderMarkdown(TABLE);

        assert.match(html, /<div data-slot="table-container" class="[^"]*overflow-x-auto/);
        assert.match(html, /<table data-slot="table"/);
    });

    // GFM states a column's alignment as an inline `text-align`. The header's own `text-left` class loses to it,
    // so dropping the style would silently left-align a column the answer aligned.
    void it("keeps the alignment GFM gives a column", async () => {
        const html = await renderMarkdown(TABLE);

        assert.match(html, /<th [^>]*style="text-align:center"[^>]*>centre<\/th>/);
        assert.match(html, /<td [^>]*style="text-align:right"[^>]*>3<\/td>/);
    });
});
