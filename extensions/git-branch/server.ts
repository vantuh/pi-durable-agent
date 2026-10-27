/** The git branch of the session's folder, beside its title. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git branch",
    description: "Shows the git branch of the session's folder beside its title.",
};

export default function gitBranch(host: Host) {
    return defineExtension({ name: host.name });
}

export const actions: Record<string, Action> = {
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
};
