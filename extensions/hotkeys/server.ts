/** App-wide keyboard shortcuts: a prefix key, then a letter, and shift with the arrows. */

import { join } from "node:path";

import { defineExtension } from "@earendil-works/pi-durable";

import { type Action, type Host, readJsonFile } from "../../server/sdk.ts";
import { mergeKeymap, type Keymap } from "./lib.ts";

export const meta = {
    title: "Hotkeys",
    description:
        "Keyboard shortcuts for new session, the sidebar's folder menu, session search, renaming, switching sessions and collapsing the sidebar. Rebind them in data/hotkeys.json.",
};

export default function hotkeys(host: Host) {
    return defineExtension({ name: host.name });
}

/** A missing or broken file means the defaults. */
export async function readKeymap(dir: string): Promise<Keymap> {
    return mergeKeymap(await readJsonFile(join(dir, "hotkeys.json")));
}

export const actions = (host: Host): Record<string, Action> => ({
    keymap: () => readKeymap(host.dataDir),
});
