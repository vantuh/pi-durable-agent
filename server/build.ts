/**
 * Rebuilds the web shell into `dist/`, the way `pnpm build` does: the same Vite, from this checkout.
 * `server/static.ts` reads the folder per request, so the new files are served without a restart.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const ROOT = join(import.meta.dirname, "..");
const VITE = join(ROOT, "node_modules/vite/bin/vite.js");
/** What a failed build says first is the error — file and line; the stack after it is Vite's own. */
const KEEP = 4000;

export type BuildResult = { ok: boolean; log: string };

let running: Promise<BuildResult> | undefined;

/** One build at a time: a second request waits for the one already writing `dist/`. */
export function buildShell(): Promise<BuildResult> {
    running ??= run().finally(() => {
        running = undefined;
    });

    return running;
}

function run(): Promise<BuildResult> {
    return new Promise((done, reject) => {
        // `process.execPath`, not `pnpm`: a server started from a phone's shortcut or a service may
        // have no package manager on its PATH, and this is the same script `pnpm build` runs.
        const child = spawn(process.execPath, [VITE, "build", "--logLevel", "warn"], {
            cwd: ROOT,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let log = "";
        // Vite colours its errors even into a pipe, and a toast shows the escapes as garbage.
        const keep = (chunk: Buffer): void => {
            log = (log + stripVTControlCharacters(chunk.toString("utf8"))).slice(0, KEEP);
        };

        child.stdout.on("data", keep);
        child.stderr.on("data", keep);
        child.on("error", reject);
        child.on("close", (code) => {
            done({ ok: code === 0, log: log.trim() });
        });
    });
}
