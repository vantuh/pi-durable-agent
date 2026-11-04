/** The git branch of the session's folder, under its title, and a menu to switch it. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { Checkout } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git branch",
    description: "Shows the git branch of the session's folder, under its title, and switches it.",
};

export default function gitBranch(host: Host) {
    return defineExtension({ name: host.name });
}

const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 5000 });

/** The local branches of the folder's repository, the current one included. */
async function localBranches(cwd: string): Promise<string[]> {
    const { stdout } = await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);

    return stdout.split("\n").filter((name) => name !== "");
}

export const actions = (host: Host): Record<string, Action> => ({
    async branch({ session }): Promise<Checkout | null> {
        const cwd = session?.cwd;

        if (cwd === undefined || cwd === null) {
            return null;
        }

        try {
            // Throws where there is no repository at all; everything below is a checkout.
            await git(cwd, ["rev-parse", "--git-dir"]);
            // No name means a detached HEAD. A repository with no commit yet still names the reference
            // its HEAD points at, so only the failure is an empty answer here.
            const { stdout: named } = await git(cwd, [
                "symbolic-ref",
                "--short",
                "-q",
                "HEAD",
            ]).catch(() => ({ stdout: "" }));
            const name = named.trim();

            return { branch: name === "" ? "HEAD" : name };
        } catch {
            return null;
        }
    },

    async branches({ session }): Promise<string[]> {
        const cwd = session?.cwd;

        return cwd === undefined || cwd === null ? [] : await localBranches(cwd).catch(() => []);
    },

    async checkout({ args, session }): Promise<Checkout> {
        const cwd = session?.cwd;
        const name =
            typeof args === "object" && args !== null ? Reflect.get(args, "branch") : undefined;

        if (session === null || cwd === undefined || cwd === null) {
            throw new ActionError("a session with a folder is needed to switch its branch");
        }

        // Only an existing local branch: a name that starts with "-" must never reach git as an option.
        if (typeof name !== "string" || !(await localBranches(cwd)).includes(name)) {
            throw new ActionError("args must be { branch: an existing local branch }");
        }

        try {
            await git(cwd, ["switch", name]);
        } catch (error) {
            // git says why: local changes in the way, or the branch is checked out in another worktree.
            const stderr: unknown =
                error instanceof Error ? Reflect.get(error, "stderr") : undefined;

            throw new ActionError(
                typeof stderr === "string" && stderr.trim() !== ""
                    ? stderr.trim()
                    : "git switch failed",
            );
        }

        host.notifySessionChanged(session.id);

        return { branch: name };
    },
});
