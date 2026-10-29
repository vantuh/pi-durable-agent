/** App-wide keyboard shortcuts: a prefix key, then a letter, and shift with the arrows. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";
import { mergeKeymap, type Keymap } from "./lib.ts";

export const meta = {
    title: "Hotkeys",
    description:
        "Keyboard shortcuts for new session, folder picker and switching sessions. Rebind them in hotkeys.json of the agent directory.",
};

export default function hotkeys(host: Host) {
    return defineExtension({ name: host.name });
}

/** A missing or broken file means the defaults. */
export async function readKeymap(dir: string): Promise<Keymap> {
    try {
        return mergeKeymap(JSON.parse(await readFile(join(dir, "hotkeys.json"), "utf8")));
    } catch {
        return mergeKeymap(undefined);
    }
}

export const actions: Record<string, Action> = {
    keymap: () => readKeymap(getAgentDir()),
};
