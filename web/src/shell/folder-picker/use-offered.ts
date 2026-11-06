import { useEffect, useState } from "react";

import type { FolderNewSessionItem } from "@/extensions.ts";

/** Whether a folder is on offer: the extensions' options may keep some out of the lists. */
export function useOffered(lists: string, options: readonly FolderNewSessionItem[]) {
    /** The folders an option keeps out of the lists: a worktree, whose main checkout is the folder to pick. */
    const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const folders = lists === "" ? [] : lists.split("\0");
        let alive = true;

        void (async () => {
            const out = await Promise.all(
                options.flatMap((option) =>
                    option.omit === undefined ? [] : [option.omit(folders).catch(() => [])],
                ),
            );

            if (alive) {
                setLeftOut(new Set(out.flat()));
            }
        })();

        return () => {
            alive = false;
        };
    }, [lists, options]);

    const offered = (folder: string): boolean => !leftOut.has(folder);

    return offered;
}
