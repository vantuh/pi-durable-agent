/** The setting file: `{"auto":true}` names a session after its run. A missing or broken file means off. */
import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "../../server/sdk.ts";

const FILE = "auto-session-name.json";

export async function readAuto(dir: string): Promise<boolean> {
    const parsed = await readJsonFile(join(dir, FILE));

    return typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "auto") === true;
}

export async function writeAuto(dir: string, auto: boolean): Promise<void> {
    await writeJsonFile(join(dir, FILE), { auto });
}
