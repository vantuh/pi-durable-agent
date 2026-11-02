import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

/** The primitive is TSX, which `node --test` cannot strip: it is loaded the way the app loads it. */
async function renderProgress(value: number): Promise<string> {
    // A cache of its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
    // dependencies there makes that server re-optimize and reload the page under the person using it.
    const cacheDir = await mkdtemp(join(tmpdir(), "progress-vite-"));
    const server = await createServer({
        server: { middlewareMode: true, hmr: false },
        cacheDir,
        appType: "custom",
    });

    try {
        const { Progress } = await server.ssrLoadModule("/src/components/ui/progress.tsx");

        return renderToStaticMarkup(createElement(Progress, { value, "aria-label": "x" }));
    } finally {
        await server.close();
        await rm(cacheDir, { recursive: true, force: true });
    }
}

void describe("progress", () => {
    // Radix reads a value above `max` as no value at all: the meter lost its `aria-valuenow` and drew an
    // empty track, which is what an over-capacity context in the context meter did.
    void it("keeps its value when the caller passes more than the meter holds", async () => {
        const html = await renderProgress(110);

        assert.ok(html.includes('aria-valuenow="100"'), html);
        assert.ok(!html.includes('data-state="indeterminate"'), html);
    });

    // Two of the hosts are buttons, which take phrasing content only, so nothing here may be a `div`.
    void it("draws its bar as phrasing content", async () => {
        const html = await renderProgress(42);

        assert.ok(!html.includes("<div"), html);
        assert.ok(html.includes('<span data-slot="progress-indicator"'), html);
    });
});
