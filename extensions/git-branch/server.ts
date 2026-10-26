/** The git branch of the session's folder, for the status bar, with its own settings. */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host } from "../../server/extensions.ts";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "./refs.ts";

const run = promisify(execFile);

export default function gitBranch(host: Host) {
    return defineExtension({ name: host.name });
}

/** A missing or broken file gives the defaults. */
async function readSettings(file: string): Promise<Settings> {
    try {
        return parseSettings(JSON.parse(await readFile(file, "utf8")));
    } catch {
        return DEFAULT_SETTINGS;
    }
}

export const actions = (host: Host): Record<string, Action> => {
    const file = join(host.dataDir, "git-branch.json");

    return {
        async branch({ session }): Promise<string | null> {
            const cwd = session?.cwd;

            if (cwd === undefined || cwd === null) {
                return null;
            }

            try {
                const { stdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                    cwd,
                    timeout: 5000,
                });

                return stdout.trim() === "" ? null : stdout.trim();
            } catch {
                return null;
            }
        },

        settings: () => readSettings(file),

        async setSettings({ args }): Promise<Settings> {
            let settings: Settings;

            try {
                settings = parseSettings(args);
            } catch (error) {
                throw new ActionError(error instanceof Error ? error.message : "bad settings");
            }

            await mkdir(host.dataDir, { recursive: true });
            await writeFile(file, JSON.stringify(settings));

            return settings;
        },
    };
};
