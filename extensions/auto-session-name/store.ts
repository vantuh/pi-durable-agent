/** The setting file: `{"auto":true}` names a session after its run. A missing or broken file means off. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonFile } from "../../server/sdk.ts";

const FILE = "auto-session-name.json";

export async function readAuto(dir: string): Promise<boolean> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, FILE), "utf8"));

        return (
            typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "auto") === true
        );
    } catch {
        return false;
    }
}

export async function writeAuto(dir: string, auto: boolean): Promise<void> {
    await writeJsonFile(join(dir, FILE), { auto });
}
