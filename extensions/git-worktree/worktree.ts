/**
 * A worktree for one session: a checkout of the session's repository, on a branch of its own, under
 * the server's data folder, so what one session does stays apart from what another does.
 *
 * It starts from the tip of the branch the session's folder is on, so the folder's local commits come
 * with it. Uncommitted changes and new files do not: a worktree is a clean place to start.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { ActionError } from "../../server/sdk.ts";
import type { MadeWorktree } from "./refs.ts";
import { mainOfRemembered, readRemembered, rememberWorktree } from "./remembered.ts";

const run = promisify(execFile);

function describe(error: unknown): string {
    if (error instanceof Error) {
        const stderr: unknown = Reflect.get(error, "stderr");

        // git says what went wrong on stderr; its own message wraps that with the whole command line.
        if (typeof stderr === "string" && stderr.trim() !== "") {
            return stderr.trim().replace(/^(fatal|error): /, "");
        }

        return error.message;
    }

    return String(error);
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

/** One worktree of this server's: its name, the folder it is, and whether that folder is still there. */
export type Worktree = { name: string; folder: string; gone: boolean };

/**
 * Whether `cwd` is one of the worktrees this server made, and whether its folder is still there: the
 * answer a session shows when the worktree it works in was deleted under it.
 */
export function worktreeOf(dataDir: string, cwd: string): Worktree | null {
    const root = join(dataDir, "worktrees");
    const at = relative(root, cwd);
    const parts = at.split(sep).filter((part) => part !== "");
    const [repository, name] = parts;

    // `<repository>/<name>` and anything below it; nothing beside the root, and nothing above it.
    if (repository === undefined || name === undefined || at.startsWith("..")) {
        return null;
    }

    const folder = join(root, repository, name);

    return { name, folder, gone: !existsSync(folder) };
}

/** A linked worktree made by someone else: its name and folder, shown but not ours to remove. */
export async function linkedWorktreeOf(
    cwd: string,
): Promise<{ name: string; folder: string } | null> {
    if ((await mainCheckoutOf(cwd)) === undefined) {
        return null;
    }

    const top = await out(cwd, ["rev-parse", "--show-toplevel"]);

    return top === "" ? null : { name: basename(top), folder: top };
}

/**
 * The main checkout of the repository a linked worktree belongs to: undefined for the main
 * checkout itself, for a folder of no repository, and for a folder that is not a worktree.
 */
export async function mainCheckoutOf(cwd: string): Promise<string | undefined> {
    const [gitDir, common] = await Promise.all([
        out(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]),
        out(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ]);

    return gitDir === "" || common === "" || gitDir === common ? undefined : dirname(common);
}

/**
 * The folder `cwd` is shown under: git's answer while the worktree is there, and the repository
 * remembered when it was made once the worktree is gone.
 */
export async function groupOf(dataDir: string, cwd: string): Promise<string | undefined> {
    return (await mainCheckoutOf(cwd)) ?? mainOfRemembered(await readRemembered(dataDir), cwd);
}

/**
 * Remove the worktree `cwd` is in: its folder, and with it whatever is in the folder and not
 * committed. The branch stays, so the commits do. A folder git would lose work in is refused.
 */
export async function removeWorktree(dataDir: string, cwd: string): Promise<{ removed: string }> {
    const worktree = worktreeOf(dataDir, cwd);

    if (worktree === null) {
        throw new ActionError("This session does not work in a worktree this server made.");
    }

    if (worktree.gone) {
        throw new ActionError("The worktree is not there any more.");
    }

    // A worktree is removed from the repository it belongs to, never from inside itself: the shell
    // that would run it is standing in the folder being deleted.
    const common = await out(worktree.folder, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ]);

    if (common === "") {
        throw new ActionError(`${worktree.folder} is not a worktree of a git repository.`);
    }

    await git(dirname(common), ["worktree", "remove", worktree.folder]).catch(
        (error: unknown): never => {
            throw new ActionError(`The worktree was not removed: ${describe(error)}`);
        },
    );

    return { removed: worktree.folder };
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
    await rememberWorktree(dataDir, worktree, root);

    return {
        path: within === "" ? worktree : resolve(worktree, within),
        worktree,
        branch: slug,
    };
}
