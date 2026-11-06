import { useEffect, useState } from "react";

import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";

import { messageOf } from "../../../shared/guards.ts";
import { worktrees, type WorktreeChoice } from "../refs.ts";

/** The repository's worktrees, with the folder they were read for: none until that folder's list lands. */
export function useWorktreeChoices(
    open: boolean,
    cwd: string | null,
    id: number | null,
): { at: string | null; choices: WorktreeChoice[] } {
    const [found, setFound] = useState<{ at: string | null; choices: WorktreeChoice[] }>({
        at: null,
        choices: [],
    });

    // Read on every open, and again when the folder moves under an open menu: nothing is made against a
    // list this folder never gave.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let alive = true;

        void (async () => {
            try {
                const read = cwd === null ? [] : await callAction(worktrees, { cwd }, id);

                if (alive) {
                    setFound({ at: cwd, choices: read });
                }
            } catch (error) {
                if (alive) {
                    setFound({ at: null, choices: [] });
                    toast.error(messageOf(error));
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, [open, cwd, id]);

    return found;
}
