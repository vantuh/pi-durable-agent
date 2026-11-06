import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { Browsers } from "./browsers.ts";
import { BrowserError } from "./cdp.ts";
import type { Saved } from "./page.ts";

void it("does not open a page whose opening outlived closeAll", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-browser-"));
    let release: () => void = () => {};
    const saved = new Promise<Saved | undefined>((resolve) => {
        release = () => resolve(undefined);
    });
    // No browser on this machine: an opening that is not stopped by the close fails on that instead.
    const browsers = new Browsers({ dataDir, executable: null, load: () => saved });

    try {
        const opening = browsers.open(1);
        const closed = assert.rejects(opening, (error: unknown) => {
            assert.ok(error instanceof BrowserError);
            assert.equal(error.message, "The browser was closed.");

            return true;
        });

        // The page is still reading its saved state, so the close runs first.
        await browsers.closeAll();
        release();
        await closed;

        assert.equal(browsers.page(1), undefined);
        assert.equal(browsers.state(1).open, false);
    } finally {
        await browsers.closeAll({ final: true });
        await rm(dataDir, { recursive: true, force: true });
    }
});
