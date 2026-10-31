/** A worktree of the session's repository, so what one session does stays apart from what another does. */

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { MadeWorktree } from "./refs.ts";
import { headOf, makeWorktree } from "./worktree.ts";

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
    head({ args }) {
        return headOf(text(args, "cwd"));
    },
});
