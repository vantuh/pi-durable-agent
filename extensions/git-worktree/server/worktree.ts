/**
 * A worktree for one session: a checkout of the session's repository, on a branch of its own, under
 * the server's data folder, so what one session does stays apart from what another does.
 *
 * It starts from the tip of the branch the session's folder is on, so the folder's local commits come
 * with it. Uncommitted changes and new files do not: a worktree is a clean place to start.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { ActionError } from "../../../server/sdk.ts";
import { folderOf, slugOf, type MadeWorktree, type WorktreeChoice } from "../refs.ts";
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
export async function repositoryOf(cwd: string): Promise<string | undefined> {
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
    if (!(await isLinkedWorktree(cwd))) {
        return null;
    }

    const top = await out(cwd, ["rev-parse", "--show-toplevel"]);

    return top === "" ? null : { name: basename(top), folder: top };
}

/** `cwd`'s own git dir and the one every worktree of its repository shares. */
async function gitDirsOf(cwd: string): Promise<{ gitDir: string; common: string }> {
    const [gitDir, common] = await Promise.all([
        out(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]),
        out(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ]);

    return { gitDir, common };
}

/**
 * Whether `cwd` is a linked worktree of a repository, whatever that repository has: a bare one has no
 * checkout, and the worktree is still a worktree.
 */
async function isLinkedWorktree(cwd: string): Promise<boolean> {
    const { gitDir, common } = await gitDirsOf(cwd);

    return gitDir !== "" && common !== "" && gitDir !== common;
}

/**
 * The main checkout of the repository a linked worktree belongs to: undefined for the main
 * checkout itself, for a folder of no repository, for a folder that is not a worktree, and for a
 * repository that is bare — its worktrees stand under nobody.
 */
export async function mainCheckoutOf(cwd: string): Promise<string | undefined> {
    const { gitDir, common } = await gitDirsOf(cwd);

    if (gitDir === "" || common === "" || gitDir === common) {
        return undefined;
    }

    // A bare repository has no checkout of its own: the folder beside its git dir is no main checkout,
    // even when it is a repository of its own.
    return (await out(common, ["rev-parse", "--is-bare-repository"])) === "true"
        ? undefined
        : dirname(common);
}

/**
 * The worktrees of the repository `cwd` is in, the main checkout first: where a session could start
 * instead of `cwd`. Nothing for a folder of no repository, and nothing for a worktree whose folder is
 * gone: there is nowhere to start.
 */
export async function worktreesOf(cwd: string): Promise<WorktreeChoice[]> {
    const [listing, top, prefix] = await Promise.all([
        // NUL-terminated lines: a folder's name may hold a newline, and git has no other way to say it.
        out(cwd, ["worktree", "list", "--porcelain", "-z"]),
        out(cwd, ["rev-parse", "--show-toplevel"]),
        out(cwd, ["rev-parse", "--show-prefix"]),
    ]);

    if (listing === "") {
        return [];
    }

    const choices: WorktreeChoice[] = [];

    // git names the main checkout first, then every linked worktree, an empty NUL apart.
    for (const [at, block] of listing.split("\0\0").entries()) {
        const lines = block.split("\0");
        const where = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
        const branch = lines.find((line) => line.startsWith("branch refs/heads/"));

        // `prunable` is a worktree whose folder is gone, and `bare` a repository with no checkout: there
        // is nowhere to start in either, and the first record is the main checkout whether or not it is one.
        if (
            where === undefined ||
            lines.includes("prunable") ||
            lines.includes("bare") ||
            !isFolder(where)
        ) {
            continue;
        }

        const inside = prefix === "" ? where : resolve(where, prefix);

        choices.push({
            name:
                branch === undefined ? basename(where) : branch.slice("branch refs/heads/".length),
            // A worktree may hold a file where the picked folder is a folder: the worktree itself then.
            path: isFolder(inside) ? inside : where,
            // The worktree's own folder, whatever branch it is on: what a menu names it by.
            root: where,
            main: at === 0,
            current: where === top,
        });
    }

    return choices;
}

/**
 * The folders among `folders` that are a linked worktree of another checkout: what the folder picker
 * leaves out of its lists, so the main checkout is the folder to pick.
 */
export async function worktreesAmong(folders: readonly string[]): Promise<string[]> {
    const linked = await Promise.all(
        folders.map(
            async (folder) =>
                // Only a linked worktree has `.git` as a file: the one cheap test that keeps git out of a listing.
                hasGitFile(folder) && (await mainCheckoutOf(folder)) !== undefined,
        ),
    );

    return folders.filter((_, at) => linked[at] === true);
}

/** A worktree's `.git` is a file naming the repository's own git folder; a checkout's is a folder. */
function hasGitFile(folder: string): boolean {
    try {
        return statSync(join(folder, ".git")).isFile();
    } catch {
        return false;
    }
}

/** Whether `folder` is a folder: a name git lists may be a file, or gone. */
export function isFolder(folder: string): boolean {
    try {
        return statSync(folder).isDirectory();
    } catch {
        return false;
    }
}

/**
 * The folder `cwd` is shown under: git's answer while the worktree is there, and the repository
 * remembered when it was made once the worktree is gone.
 */
export async function groupOf(dataDir: string, cwd: string): Promise<string | undefined> {
    const main = await mainCheckoutOf(cwd);

    if (main !== undefined) {
        return main;
    }

    const remembered = await readRemembered(dataDir);
    const known = mainOfRemembered(remembered, cwd);
    const mine = worktreeOf(dataDir, cwd);

    if (known !== undefined || mine?.gone !== true) {
        return known;
    }

    // Older worktrees have no record of their own; only agreeing siblings can identify their repository.
    const candidates = new Set(
        [...remembered]
            .filter(([folder]) => dirname(folder) === dirname(mine.folder))
            .map(([, repository]) => repository),
    );
    const mains = new Set(
        await Promise.all(
            [...candidates].map(
                async (candidate) =>
                    (await mainCheckoutOf(candidate)) ?? (await repositoryOf(candidate)),
            ),
        ),
    );

    mains.delete(undefined);

    return mains.size === 1 ? [...mains][0] : undefined;
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
    const worktree = join(dataDir, "worktrees", await repositoryName(cwd), folderOf(slug));

    if (existsSync(worktree)) {
        throw new ActionError(
            `There is already a worktree named ${folderOf(slug)}: pick another name.`,
        );
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
