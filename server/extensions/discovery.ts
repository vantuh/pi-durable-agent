/** What is on disk around the extensions: the folders that hold a `server.ts`, and the owner's on/off choice. */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonFile } from "../atomic-write.ts";
import { readJsonFile } from "../json-file.ts";

/** Where the owner's choice is kept, in the data directory. */
const STATE_FILE = "extensions.json";

/** A missing or broken file means every folder is on. */
export async function readDisabled(dataDir: string): Promise<Set<string>> {
    const state = await readJsonFile(join(dataDir, STATE_FILE));
    const list: unknown =
        typeof state === "object" && state !== null ? Reflect.get(state, "disabled") : undefined;

    return new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
}

export async function writeDisabled(dataDir: string, disabled: ReadonlySet<string>): Promise<void> {
    await writeJsonFile(join(dataDir, STATE_FILE), { disabled: [...disabled].sort() });
}

/** Folders of `dir` that hold a `server.ts`, in name order. A folder with only web code is not one. */
export async function serverFolders(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
            continue;
        }

        const file = join(dir, entry.name, "server.ts");

        try {
            await stat(file);
            folders.push(entry.name);
        } catch {
            continue;
        }
    }

    return folders.sort();
}
