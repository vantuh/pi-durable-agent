/** Watching the extensions directory: which folders a burst of saves touched, handed over once it has settled. */

import { type FSWatcher, watch } from "node:fs";
import { sep } from "node:path";

/** How long a burst of saves is collected before loading again. */
const SETTLE_MS = 150;

/** Subfolders of an extension that the server half never loads from: browser code, files read by path, test data. */
const NOT_SERVER = new Set(["web", "assets", "fixtures"]);

export type FolderWatch = { close: () => void };

/**
 * Calls `settled` with the folders of `dir` whose server half changed, once saves stop for `SETTLE_MS`. A burst is
 * one call; closing drops a call that has not gone yet.
 */
export function watchFolders(
    dir: string,
    settled: (changed: ReadonlySet<string>) => void,
): FolderWatch {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const watcher: FSWatcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (filename === null) {
            return;
        }
        const parts = filename.split(sep);
        const folder = parts[0];
        if (folder === undefined || folder.startsWith(".") || folder.startsWith("_")) {
            return;
        }
        // Not the server half: `web/` goes live through Vite, `assets/` and `fixtures/` are read by path.
        if (parts[1] !== undefined && NOT_SERVER.has(parts[1])) {
            return;
        }
        // Of the rest, only the server half: `web.tsx` goes live through Vite, a test file is never loaded.
        // A name with no dot is the folder or a subfolder, which may have taken a `.ts` with it.
        const name = filename.slice(filename.lastIndexOf(sep) + 1);
        const serverHalf = name.endsWith(".ts") && !name.endsWith(".test.ts");

        if (!serverHalf && name.includes(".")) {
            return;
        }
        pending.add(folder);
        if (timer !== undefined) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            timer = undefined;
            const changed = new Set(pending);
            pending.clear();
            settled(changed);
        }, SETTLE_MS);
    });

    return {
        close: () => {
            watcher.close();

            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        },
    };
}
