import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Host } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import type { Saved } from "./lib/page.ts";
import { normalizeUrl } from "./lib/urls.ts";
import { viewportFrom } from "./lib/viewport.ts";
import createBrowser from "./server.ts";

void describe("browser addresses", () => {
    void it("opens local servers over http and other hosts over https", () => {
        assert.equal(normalizeUrl("localhost:5173"), "http://localhost:5173/");
        assert.equal(normalizeUrl("example.com"), "https://example.com/");
    });

    void it("refuses schemes that run code or reach the browser itself", () => {
        assert.equal(normalizeUrl("javascript:alert(1)"), undefined);
        assert.equal(normalizeUrl("chrome://settings"), undefined);
    });

    void it("opens files only when trusted", () => {
        assert.equal(normalizeUrl("/etc/hosts"), undefined);
        assert.equal(normalizeUrl("/etc/hosts", { trusted: true, cwd: "/" }), "file:///etc/hosts");
    });
});

void describe("browser viewports", () => {
    void it("reads presets and WIDTHxHEIGHT, and clamps sizes", () => {
        assert.equal(viewportFrom("mobile")?.width, 390);
        assert.deepEqual(viewportFrom("1024x768"), {
            width: 1024,
            height: 768,
            scale: 1,
            mobile: false,
        });
        assert.equal(viewportFrom("9999x9999")?.width, 3840);
        assert.equal(viewportFrom("huge"), undefined);
    });
});

/** The fields this extension reads; the rest of the host is nothing it touches. */
function hostOf(dataDir: string): { host: Host; log: string[]; stop: () => Promise<void> } {
    const log: string[] = [];
    const disposers: (() => void | Promise<void>)[] = [];

    return {
        log,
        host: testHost({
            name: "browser",
            cwd: dataDir,
            dataDir,
            log: (line) => log.push(line),
            onDispose: (dispose) => disposers.push(dispose),
        }),
        /** What the server does when the extension stops: run what it registered, then exit. */
        stop: async () => {
            for (const dispose of disposers.reverse()) {
                await dispose();
            }
        },
    };
}

void describe("browser saved pages", () => {
    let dir: string;

    const saved: Saved = {
        url: "https://example.com/",
        viewport: { width: 390, height: 844, scale: 2, mobile: true },
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "browser-saved-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    void it("keeps the store a reload found, and writes its last save before it stops", async () => {
        const first = hostOf(dir);

        createBrowser(first.host);
        const running = globalThis.piDurableBrowser;

        assert.ok(
            running !== undefined,
            "the extension keeps the running browser where a reload finds it",
        );

        running.store.save(1, saved);

        const reloaded = hostOf(dir);

        createBrowser(reloaded.host);
        assert.equal(
            globalThis.piDurableBrowser?.store,
            running.store,
            "a reload saves into the store the pages use, not a second one nothing writes",
        );

        // The process exits right after this, so the disposer is the last moment the write can land.
        await reloaded.stop();

        assert.deepEqual(JSON.parse(await readFile(join(dir, "browser", "saved.json"), "utf8")), {
            "1": saved,
        });
        assert.deepEqual(reloaded.log, []);
    });

    void it("logs a save that cannot be written, and stopping does not throw", async () => {
        const { host, log, stop } = hostOf(dir);

        // A file where the store's folder should be: every write fails.
        await writeFile(join(dir, "browser"), "");

        createBrowser(host);

        const store = globalThis.piDurableBrowser?.store;

        assert.ok(store !== undefined);

        store.save(1, saved);
        await store.flush();

        assert.match(log.join("\n"), /the open pages were not saved/);
        await stop();
    });
});
