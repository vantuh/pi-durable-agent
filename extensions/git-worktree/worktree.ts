/**
 * A worktree for one session: a checkout of the session's repository, on a branch of its own, under
 * the server's data folder, so what one session does stays apart from what another does.
 *
 * It starts from the tip of the branch the session's folder is on, so the folder's local commits come
 * with it. Uncommitted changes and new files do not: a worktree is a clean place to start.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { ActionError } from "../../server/sdk.ts";
import type { MadeWorktree } from "./refs.ts";

const run = promisify(execFile);

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await run("git", args, {
        cwd,
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
    });

    return stdout;
}

/** The command's output trimmed, or an empty string when it fails: how git answers "there is none". */
async function out(cwd: string, args: string[]): Promise<string> {
    return git(cwd, args).then(
        (text) => text.trim(),
        () => "",
    );
}

/** The top folder of the repository `cwd` is in, or undefined when it is in none. */
async function repositoryOf(cwd: string): Promise<string | undefined> {
    return (await out(cwd, ["rev-parse", "--show-toplevel"])) || undefined;
}

/**
 * The folder a worktree goes under, named after the repository it belongs to: from inside a linked
 * worktree that is still the repository the worktree was made from.
 */
async function repositoryName(cwd: string): Promise<string> {
    const common = await out(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

    // The shared git dir sits in the repository's own folder, whatever worktree it was read from.
    return basename(dirname(common));
}

/** A folder name and branch name for what someone typed: what git accepts, in lowercase. */
export function slugOf(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 40)
        .replace(/[-.]+$/, "");
}

/**
 * Make a worktree of the repository `cwd` is in, named `name`, under `dataDir`. The session starts in
 * the folder of the worktree that matches `cwd`, so a folder inside the repository keeps its place.
 */
export async function makeWorktree(
    dataDir: string,
    cwd: string,
    name: string,
): Promise<MadeWorktree> {
    const slug = slugOf(name);

    if (slug === "") {
        throw new ActionError("Name the worktree with letters or digits.");
    }

    const root = await repositoryOf(cwd);

    if (root === undefined) {
        throw new ActionError(`${cwd} is not in a git repository, so it cannot have a worktree.`);
    }

    if ((await out(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) === "") {
        throw new ActionError("The repository has no commits yet: commit once, then try again.");
    }

    // Where `cwd` is within the repository, as git sees it: `cwd` may be reached through a symbolic link.
    const within = (await out(cwd, ["rev-parse", "--show-prefix"])).trim();
    const worktree = join(dataDir, "worktrees", await repositoryName(cwd), slug);

    if (existsSync(worktree)) {
        throw new ActionError(`There is already a worktree named ${slug}: pick another name.`);
    }

    if ((await out(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${slug}`])) !== "") {
        throw new ActionError(`This repository already has a branch named ${slug}.`);
    }

    mkdirSync(dirname(worktree), { recursive: true });
    await git(root, ["worktree", "add", "-b", slug, worktree, "HEAD"]).catch(
        (error: unknown): never => {
            throw new ActionError(`The worktree could not be set up: ${describe(error)}`);
        },
    );

    return {
        path: within === "" ? worktree : resolve(worktree, within),
        worktree,
        branch: slug,
    };
}
