/** The state file: the switch, the stopped conversations and the last ping of each. A missing or broken file means on. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Ping } from "./refs.ts";
import type { Stored } from "./warm.ts";

const FILE = "keep-warm.json";

function pingOf(value: unknown): Ping | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const at: unknown = Reflect.get(value, "at");
    const model: unknown = Reflect.get(value, "model");

    if (typeof at !== "number" || typeof model !== "string") {
        return undefined;
    }

    const read: unknown = Reflect.get(value, "read");
    const write: unknown = Reflect.get(value, "write");
    const error: unknown = Reflect.get(value, "error");

    return {
        at,
        model,
        ...(typeof read === "number" ? { read } : {}),
        ...(typeof write === "number" ? { write } : {}),
        ...(typeof error === "string" ? { error } : {}),
    };
}

export async function readStore(dir: string): Promise<Stored> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, FILE), "utf8"));

        if (typeof parsed !== "object" || parsed === null) {
            return {};
        }

        const off: unknown = Reflect.get(parsed, "off");
        const stored: unknown = Reflect.get(parsed, "last");
        const stops: unknown = Reflect.get(parsed, "stop");
        const last: Record<string, Ping> = {};
        const stop: Record<string, number> = {};

        if (typeof stops === "object" && stops !== null) {
            for (const [session, value] of Object.entries(stops)) {
                if (typeof value === "number") {
                    stop[session] = value;
                }
            }
        }

        if (typeof stored === "object" && stored !== null) {
            for (const [session, value] of Object.entries(stored)) {
                const ping = pingOf(value);

                if (ping !== undefined) {
                    last[session] = ping;
                }
            }
        }

        return {
            ...(off === true ? { off: true as const } : {}),
            ...(Object.keys(stop).length === 0 ? {} : { stop }),
            ...(Object.keys(last).length === 0 ? {} : { last }),
        };
    } catch {
        return {};
    }
}

export async function writeStore(dir: string, store: Stored): Promise<void> {
    const file = join(dir, FILE);
    const temporary = `${file}.${String(process.pid)}.tmp`;

    await mkdir(dir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(store)}\n`);
    await rename(temporary, file);
}
