import { callAction } from "@/sdk/actions.ts";
import type { WebExtension } from "@/sdk/types.ts";

import { linked, make } from "./refs.ts";
import { chosenOf, NAME, nameOf } from "./web/collected.ts";
import { SessionMark } from "./web/session-mark.tsx";
import { Worktree } from "./web/worktree.tsx";

export default {
    status: [{ id: "worktree", slot: "title", component: SessionMark }],
    newSession: [
        {
            id: "worktree",
            component: Worktree,
            blocked: (collected) =>
                collected !== null && Object.hasOwn(collected, NAME) && nameOf(collected) === ""
                    ? "Name the worktree."
                    : null,
            // The picker leaves the worktrees out of its lists: their repository's folder is the one to pick.
            omit: (folders) => callAction(linked, { folders: [...folders] }, null),
            place: async (cwd, collected) => {
                const chosen = chosenOf(collected);

                if (chosen !== null) {
                    return chosen;
                }

                const name = nameOf(collected);

                if (name === "") {
                    throw new Error("Name the worktree.");
                }

                return (await callAction(make, { cwd, name }, null)).path;
            },
        },
    ],
} satisfies WebExtension;
