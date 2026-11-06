import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "../../../server/sdk.ts";
import { PROVIDERS, type Settings } from "../refs.ts";

const KNOWN: readonly string[] = PROVIDERS.map((each) => each.id);

/** A missing, broken or surprising file means everything is shown. */
export async function readSettings(dir: string): Promise<Settings> {
    const parsed = await readJsonFile(join(dir, "usage-limits.json"));
    const hidden: unknown =
        typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "hidden") : undefined;

    return {
        hidden: Array.isArray(hidden)
            ? hidden.filter((id): id is string => typeof id === "string" && KNOWN.includes(id))
            : [],
    };
}

export async function writeSettings(dir: string, settings: Settings): Promise<void> {
    await writeJsonFile(join(dir, "usage-limits.json"), settings);
}
