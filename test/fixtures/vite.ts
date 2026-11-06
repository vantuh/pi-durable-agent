// The app's sources through a Vite of the test's own, for a test that loads a component or opens the shell.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type InlineConfig, type ViteDevServer } from "vite";

export type TestVite = { vite: ViteDevServer; stop: () => Promise<void> };

/**
 * `cacheDir` is its own: `node_modules/.vite` belongs to the dev server, and a second Vite writing its
 * dependencies there makes that server re-optimize and reload the page under the person using it.
 * `ws: false` as well as `hmr: false`: in middleware mode Vite still opens its socket on 24678 otherwise,
 * and tests that run side by side print "Port 24678 is already in use".
 */
export async function startVite(
    appType: "spa" | "custom",
    extra: InlineConfig = {},
): Promise<TestVite> {
    const cacheDir = await mkdtemp(join(tmpdir(), "vite-test-"));
    const vite = await createServer({
        server: { middlewareMode: true, hmr: false, ws: false },
        cacheDir,
        appType,
        ...extra,
    });

    return {
        vite,
        stop: async () => {
            await vite.close();
            // Vite can still be writing its dependency cache as it closes, so the first removal may race it.
            await rm(cacheDir, { recursive: true, force: true, maxRetries: 5 });
        },
    };
}
