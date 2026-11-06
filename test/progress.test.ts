import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { startVite } from "./fixtures/vite.ts";

/** The primitive is TSX, which `node --test` cannot strip: it is loaded the way the app loads it. */
async function renderProgress(value: number): Promise<string> {
    const { vite: server, stop } = await startVite("custom");

    try {
        const { Progress } = await server.ssrLoadModule("/src/components/ui/progress.tsx");

        return renderToStaticMarkup(createElement(Progress, { value, "aria-label": "x" }));
    } finally {
        await stop();
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
