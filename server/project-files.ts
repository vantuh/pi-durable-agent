/** The files of a folder, for `@` in the composer: what git tracks plus what it does not ignore; any other folder is walked. */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const LIMIT = 20_000;
const SKIPPED = new Set([".git", "node_modules"]);

async function walk(root: string, folder: string, found: string[]): Promise<void> {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
        if (found.length >= LIMIT || SKIPPED.has(entry.name)) {
            continue;
        }

        const path = folder === "" ? entry.name : `${folder}/${entry.name}`;

        if (entry.isDirectory()) {
            await walk(root, path, found);
        } else if (entry.isFile()) {
            found.push(path);
        }
    }
}

/** Paths relative to `cwd`, with `/`. */
export async function projectFiles(cwd: string): Promise<string[]> {
    try {
        const { stdout } = await run(
            "git",
            ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            { cwd, maxBuffer: 64 * 1024 * 1024 },
        );

        return stdout
            .split("\0")
            .filter((path) => path !== "")
            .slice(0, LIMIT);
    } catch {
        const found: string[] = [];

        try {
            await walk(cwd, "", found);
        } catch {
            return found;
        }

        return found;
    }
}
