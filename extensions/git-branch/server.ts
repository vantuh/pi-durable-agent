/** The git branch of the session's folder, under its title, and a menu to switch it. */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { Branch, Checkout } from "./refs.ts";

const run = promisify(execFile);

export const meta = {
    title: "Git branch",
    description:
        "Shows the git branch of the session's folder, under its title, and switches it, or moves the session to the worktree that has the branch.",
};

export default function gitBranch(host: Host) {
    return defineExtension({ name: host.name });
}

const git = (cwd: string, args: string[]) => run("git", args, { cwd, timeout: 5000 });

/** The folder of every worktree that has a branch checked out, by branch. A worktree whose folder is gone is left out. */
async function checkedOut(cwd: string): Promise<Map<string, string>> {
    const { stdout } = await git(cwd, ["worktree", "list", "--porcelain"]);
    const places = new Map<string, string>();

    for (const block of stdout.split("\n\n")) {
        const lines = block.split("\n");
        const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
        const name = lines
            .find((line) => line.startsWith("branch refs/heads/"))
            ?.slice("branch refs/heads/".length);

        if (
            path !== undefined &&
            name !== undefined &&
            !lines.some((l) => l.startsWith("prunable"))
        ) {
            places.set(name, path);
        }
    }

    return places;
}

/** The local branches of the folder's repository; those another worktree has checked out say where. */
async function branchesOf(cwd: string): Promise<Branch[]> {
    const { stdout } = await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    const { stdout: top } = await git(cwd, ["rev-parse", "--show-toplevel"]);
    const here = await realpath(top.trim());
    const places = await checkedOut(cwd);
    const elsewhere = new Map<string, string>();

    for (const [name, path] of places) {
        // Git prints the path as the worktree was added; the session's folder may reach it by another way.
        if ((await realpath(path).catch(() => path)) !== here) {
            elsewhere.set(name, path);
        }
    }

    return stdout
        .split("\n")
        .filter((name) => name !== "")
        .map((name) => ({ name, worktree: elsewhere.get(name) ?? null }));
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

    async branches({ session }): Promise<Branch[]> {
        const cwd = session?.cwd;

        return cwd === undefined || cwd === null ? [] : await branchesOf(cwd).catch(() => []);
    },

    async checkout({ args, session }): Promise<Checkout> {
        const cwd = session?.cwd;
        const name =
            typeof args === "object" && args !== null ? Reflect.get(args, "branch") : undefined;

        if (session === null || cwd === undefined || cwd === null) {
            throw new ActionError("a session with a folder is needed to switch its branch");
        }

        // Only an existing local branch: a name that starts with "-" must never reach git as an option.
        const found =
            typeof name === "string"
                ? (await branchesOf(cwd)).find((each) => each.name === name)
                : undefined;

        if (found === undefined) {
            throw new ActionError("args must be { branch: an existing local branch }");
        }

        // The agent's files would change under a run that is going on.
        if (await host.sessionWorking(session.id)) {
            throw new ActionError("the agent is working; wait for it to finish");
        }

        if (found.worktree === null) {
            try {
                await git(cwd, ["switch", found.name]);
            } catch (error) {
                // git says why: local changes in the way.
                const stderr: unknown =
                    error instanceof Error ? Reflect.get(error, "stderr") : undefined;

                throw new ActionError(
                    typeof stderr === "string" && stderr.trim() !== ""
                        ? stderr.trim()
                        : "git switch failed",
                );
            }
        } else {
            await host.setSessionCwd(session.id, found.worktree);
        }

        host.notifySessionChanged(session.id);

        return { branch: found.name };
    },
});
