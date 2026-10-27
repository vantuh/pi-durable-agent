/** The git branch of the session's folder, and its worktree when it is a linked one, under its title. */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import type { Action, Host } from "../../server/sdk.ts";
import type { Checkout } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git branch",
    description: "Shows the git branch of the session's folder, and its worktree, under its title.",
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
            const { stdout } = await run(
                "git",
                [
                    "rev-parse",
                    "--abbrev-ref",
                    "HEAD",
                    "--path-format=absolute",
                    "--git-dir",
                    "--git-common-dir",
                    "--show-toplevel",
                ],
                { cwd, timeout: 5000 },
            );
            const [name = "", gitDir, commonDir, top = ""] = stdout.trim().split("\n");

            if (name === "") {
                return null;
            }

            // A linked worktree keeps its own git dir beside the shared one; the main checkout's are the same.
            return { branch: name, worktree: gitDir === commonDir ? null : basename(top) };
        } catch {
            return null;
        }
    },
};
