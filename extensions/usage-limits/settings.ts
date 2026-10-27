import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PROVIDERS, type Settings } from "./refs.ts";

const KNOWN: readonly string[] = PROVIDERS.map((each) => each.id);

/** A missing, broken or surprising file means everything is shown. */
export async function readSettings(dir: string): Promise<Settings> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, "usage-limits.json"), "utf8"));
        const hidden: unknown =
            typeof parsed === "object" && parsed !== null
                ? Reflect.get(parsed, "hidden")
                : undefined;

        return {
            hidden: Array.isArray(hidden)
                ? hidden.filter((id): id is string => typeof id === "string" && KNOWN.includes(id))
                : [],
        };
    } catch {
        return { hidden: [] };
    }
}

export async function writeSettings(dir: string, settings: Settings): Promise<void> {
    const file = join(dir, "usage-limits.json");
    const temporary = `${file}.${String(process.pid)}.tmp`;

    await mkdir(dir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(settings)}\n`);
    await rename(temporary, file);
}
