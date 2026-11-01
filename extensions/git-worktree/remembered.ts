/**
 * What this server made, kept after the worktree is gone: `git worktree list` forgets a removed
 * worktree, so git can no longer say which repository its sessions belong under.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

const FILE = "git-worktree.json";

/** A worktree's folder → the repository folder it was made from. */
export type Remembered = ReadonlyMap<string, string>;

/** The repository remembered for `cwd` or for the worktree it sits in; the closest worktree wins. */
export function mainOfRemembered(remembered: Remembered, cwd: string): string | undefined {
    let best: [string, string] | undefined;

    for (const [folder, main] of remembered) {
        const inside = cwd === folder || cwd.startsWith(`${folder}${sep}`);

        if (inside && (best === undefined || folder.length > best[0].length)) {
            best = [folder, main];
        }
    }

    return best?.[1];
}

/** Nothing for a file that is missing or holds something else. */
export async function readRemembered(dataDir: string): Promise<Remembered> {
    const text = await readFile(join(dataDir, FILE), "utf8").catch(() => "");
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        return new Map();
    }

    const rows = new Map<string, string>();

    if (typeof parsed === "object" && parsed !== null) {
        for (const key of Object.keys(parsed)) {
            const main: unknown = Reflect.get(parsed, key);

            if (typeof main === "string") {
                rows.set(key, main);
            }
        }
    }

    return rows;
}

/** Adds one and rewrites the file: it is small, and one person makes worktrees one at a time. */
export async function rememberWorktree(
    dataDir: string,
    worktree: string,
    main: string,
): Promise<void> {
    const rows = new Map(await readRemembered(dataDir));

    rows.set(worktree, main);

    const target = join(dataDir, FILE);
    const temp = `${target}.tmp`;

    await writeFile(temp, JSON.stringify(Object.fromEntries(rows)), "utf8");
    await rename(temp, target);
}
