/** A worktree of the session's repository, so what one session does stays apart from what another does. */

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import { recordOf } from "../../shared/guards.ts";
import type { Entered, MadeWorktree, WorktreeChoice, WorktreeState } from "./refs.ts";
import {
    groupOf,
    isFolder,
    linkedWorktreeOf,
    makeWorktree,
    removeWorktree,
    repositoryOf,
    worktreeOf,
    worktreesAmong,
    worktreesOf,
} from "./worktree.ts";

/** What the main checkout is called wherever a worktree of the session's repository is offered. */
const MAIN = "Main checkout";

export const meta = {
    title: "Git worktree",
    description:
        "Starts a new session in a git worktree of its own, named in the folder picker, or in one the repository already has; moves the open session between the worktrees of its repository.",
};

export default function gitWorktree(host: Host) {
    // A folder's repository does not change while the sessions in it are listed, and the list asks
    // for every row on every change: git runs once per folder. A reload or restart asks again.
    const mains = new Map<string, Promise<string | undefined>>();

    host.folderGroup((cwd) => {
        const known = mains.get(cwd) ?? groupOf(host.dataDir, cwd);

        mains.set(cwd, known);

        return known;
    });

    return defineExtension({ name: host.name });
}

function text(args: unknown, key: string): string {
    const value: unknown = recordOf(args)?.[key];

    if (typeof value !== "string" || value.trim() === "") {
        throw new ActionError(`\`${key}\` must be a non-empty string.`);
    }

    return value;
}

function foldersOf(args: unknown): string[] {
    const value: unknown = recordOf(args)?.["folders"];

    if (!Array.isArray(value) || value.some((entry: unknown) => typeof entry !== "string")) {
        throw new ActionError("`folders` must be a list of folders.");
    }

    return value;
}

/**
 * The worktree `cwd` works in — this server's, someone else's, or the main checkout of its repository.
 * Null for a folder outside git, and for a folder that is not there.
 */
async function stateOf(host: Host, cwd: string): Promise<WorktreeState | null> {
    const mine = worktreeOf(host.dataDir, cwd);

    if (mine !== null) {
        return { ...mine, main: false, ours: true };
    }

    const linked = await linkedWorktreeOf(cwd);

    if (linked !== null) {
        return { ...linked, gone: false, main: false, ours: false };
    }

    const top = await repositoryOf(cwd);

    return top === undefined
        ? null
        : { name: MAIN, folder: top, gone: false, main: true, ours: false };
}

/**
 * The session that may move: one with a folder, and not one whose agent is running — its files would
 * change under it.
 */
async function ready(
    host: Host,
    session: { readonly id: number; readonly cwd: string | null } | null,
): Promise<{ id: number; cwd: string }> {
    if (session === null || session.cwd === null) {
        throw new ActionError("a session with a folder is needed to move it to a worktree");
    }

    if (await host.sessionWorking(session.id)) {
        throw new ActionError("the agent is working; wait for it to finish");
    }

    return { id: session.id, cwd: session.cwd };
}

/** Puts the session in `path` — when it is not there already — and tells the rest of the app. */
async function enter(host: Host, id: number, path: string, moved: boolean): Promise<Entered> {
    // Listing the worktrees runs git, which takes time: the agent may have started meanwhile.
    if (await host.sessionWorking(id)) {
        throw new ActionError("the agent is working; wait for it to finish");
    }

    if (moved) {
        await host.setSessionCwd(id, path);
    }

    host.notifySessionChanged(id);

    return { moved, path };
}

export const actions = (host: Host): Record<string, Action> => ({
    make({ args }): Promise<MadeWorktree> {
        return makeWorktree(host.dataDir, text(args, "cwd"), text(args, "name"));
    },
    worktrees({ args }): Promise<WorktreeChoice[]> {
        return worktreesOf(text(args, "cwd"));
    },
    linked({ args }): Promise<string[]> {
        return worktreesAmong(foldersOf(args));
    },
    state({ args }): Promise<WorktreeState | null> {
        return stateOf(host, text(args, "cwd"));
    },
    async move({ args, session }) {
        const { id, cwd } = await ready(host, session);
        const wanted = text(args, "worktree");
        // Read again here: the folder the caller named may be of another repository, or gone since.
        const found = (await worktreesOf(cwd)).find((each) => each.root === wanted);

        if (found === undefined) {
            throw new ActionError("`worktree` must be a worktree of the session's repository.");
        }

        // A session already there keeps the folder it is in: no move, and nothing to tell the agent.
        return await enter(host, id, found.current ? cwd : found.path, !found.current);
    },
    async create({ args, session }) {
        const { id, cwd } = await ready(host, session);
        const made = await makeWorktree(host.dataDir, cwd, text(args, "name"));

        // The folder matching the session's may be one the new worktree does not have: it starts clean.
        return await enter(host, id, isFolder(made.path) ? made.path : made.worktree, true);
    },
    async remove({ args, session }) {
        const removed = await removeWorktree(host.dataDir, text(args, "cwd"));

        // The badges beside the button are another extension's, and their answer changed too.
        if (session !== null) {
            host.notifySessionChanged(session.id);
        }

        return removed;
    },
});
