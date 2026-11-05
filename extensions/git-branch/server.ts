/** The git branch of the session's folder, under its title, and a menu to switch it. */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { Branch, Checkout, Moved } from "./refs.ts";

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

/** The folder of every worktree that has a branch checked out, by branch. A worktree git calls prunable is left out. */
async function checkedOut(cwd: string): Promise<Map<string, string>> {
    // NUL-separated, so a folder name with a newline or a quote comes back as it is.
    const { stdout } = await git(cwd, ["worktree", "list", "--porcelain", "-z"]);
    const places = new Map<string, string>();
    let path: string | undefined;
    let name: string | undefined;
    let gone = false;

    const flush = () => {
        if (path !== undefined && name !== undefined && !gone) {
            places.set(name, path);
        }

        path = undefined;
        name = undefined;
        gone = false;
    };

    for (const field of stdout.split("\0")) {
        if (field === "") {
            flush();
        } else if (field.startsWith("worktree ")) {
            path = field.slice("worktree ".length);
        } else if (field.startsWith("branch refs/heads/")) {
            name = field.slice("branch refs/heads/".length);
        } else if (field.startsWith("prunable")) {
            gone = true;
        }
    }

    flush();

    return places;
}

/**
 * The local branches of the folder's repository; those another worktree has checked out say where,
 * as a folder that exists now.
 */
async function branchesOf(cwd: string): Promise<Branch[]> {
    const { stdout } = await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    const { stdout: top } = await git(cwd, ["rev-parse", "--show-toplevel"]);
    // Only git's own newline goes: a folder name may end in a space.
    const here = await realpath(top.replace(/\n$/, ""));
    const places = await checkedOut(cwd);
    const elsewhere = new Map<string, string>();

    for (const [name, path] of places) {
        // Git prints the path as the worktree was added; the session's folder may reach it by another
        // way. A folder that is gone cannot take a session, so its branch is not offered as a move.
        const real = await realpath(path).catch(() => undefined);

        if (real !== undefined && real !== here) {
            elsewhere.set(name, real);
        }
    }

    return stdout
        .split("\n")
        .filter((name) => name !== "")
        .map((name) => ({ name, worktree: elsewhere.get(name) ?? null }));
}

/** git's own reason for a failed command, which is what a person can act on. */
function gitFailure(error: unknown, fallback: string): ActionError {
    const stderr: unknown = error instanceof Error ? Reflect.get(error, "stderr") : undefined;

    return new ActionError(
        typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : fallback,
    );
}

/**
 * The name unchanged, or a refusal: git's own rules for a branch name, minus the shorthands an
 * older git expands here (`@{-1}`, which names somebody else's branch rather than a new one).
 */
async function checkedName(cwd: string, name: string): Promise<string> {
    // A name that starts with "-" must never reach git as an option.
    if (name === "" || name.startsWith("-")) {
        throw new ActionError(`"${name}" is not a valid branch name`);
    }

    const { stdout } = await git(cwd, ["check-ref-format", "--branch", name]).catch(() => ({
        stdout: "",
    }));

    if (stdout.trim() !== name) {
        throw new ActionError(`"${name}" is not a valid branch name`);
    }

    return name;
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

    async checkout({ args, session }): Promise<Moved> {
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
                throw gitFailure(error, "git switch failed");
            }
        } else {
            await host.setSessionCwd(session.id, found.worktree);
        }

        host.notifySessionChanged(session.id);

        return { branch: found.name, worktree: found.worktree };
    },

    async create({ args, session }): Promise<Checkout> {
        const cwd = session?.cwd;
        const name =
            typeof args === "object" && args !== null ? Reflect.get(args, "branch") : undefined;

        if (session === null || cwd === undefined || cwd === null) {
            throw new ActionError("a session with a folder is needed to create a branch");
        }

        if (typeof name !== "string") {
            throw new ActionError("args must be { branch: a new branch name }");
        }

        const wanted = await checkedName(cwd, name);

        // The agent's files would change under a run that is going on.
        if (await host.sessionWorking(session.id)) {
            throw new ActionError("the agent is working; wait for it to finish");
        }

        try {
            // At the current commit, in the session's own folder: uncommitted changes stay, and an
            // existing branch is git's refusal, never an overwrite.
            await git(cwd, ["switch", "-c", wanted]);
        } catch (error) {
            throw gitFailure(error, "git switch -c failed");
        }

        host.notifySessionChanged(session.id);

        return { branch: wanted };
    },
});
