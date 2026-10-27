/** The setting file: `{"auto":true}` names a session after its run. A missing or broken file means off. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
    const file = join(dir, FILE);
    const temporary = `${file}.${String(process.pid)}.tmp`;

    await mkdir(dir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ auto })}\n`);
    await rename(temporary, file);
}
