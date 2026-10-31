/** The git branch of the session's folder, under its title. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";
import type { Checkout } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git branch",
    description: "Shows the git branch of the session's folder, under its title.",
};

export default function gitBranch(host: Host) {
    return defineExtension({ name: host.name });
}

export const actions: Record<string, Action> = {
    async branch({ session }): Promise<Checkout | null> {
        const cwd = session?.cwd;

        if (cwd === undefined || cwd === null) {
            return null;
        }

        try {
            // Throws where there is no repository at all; everything below is a checkout.
            await run("git", ["rev-parse", "--git-dir"], { cwd, timeout: 5000 });
            // No name means a detached HEAD. A repository with no commit yet still names the reference
            // its HEAD points at, so only the failure is an empty answer here.
            const { stdout: named } = await run("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
                cwd,
                timeout: 5000,
            }).catch(() => ({ stdout: "" }));
            const name = named.trim();

            return { branch: name === "" ? "HEAD" : name };
        } catch {
            return null;
        }
    },
};
