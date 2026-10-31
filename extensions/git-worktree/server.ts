/** A worktree of the session's repository, so what one session does stays apart from what another does. */

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { MadeWorktree } from "./refs.ts";
import { linkedWorktreeOf, makeWorktree, removeWorktree, worktreeOf } from "./worktree.ts";

export const meta = {
    title: "Git worktree",
    description: "Starts a new session in a git worktree of its own, named in the folder picker.",
};

export default function gitWorktree(host: Host) {
    return defineExtension({ name: host.name });
}

function text(args: unknown, key: string): string {
    const value: unknown =
        typeof args === "object" && args !== null ? Reflect.get(args, key) : undefined;

    if (typeof value !== "string" || value.trim() === "") {
        throw new ActionError(`\`${key}\` must be a non-empty string.`);
    }

    return value;
}

export const actions = (host: Host): Record<string, Action> => ({
    make({ args }): Promise<MadeWorktree> {
        return makeWorktree(host.dataDir, text(args, "cwd"), text(args, "name"));
    },
    async state({ args }) {
        const cwd = text(args, "cwd");
        const mine = worktreeOf(host.dataDir, cwd);

        if (mine !== null) {
            return { ...mine, ours: true };
        }

        const linked = await linkedWorktreeOf(cwd);

        return linked === null ? null : { ...linked, gone: false, ours: false };
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
