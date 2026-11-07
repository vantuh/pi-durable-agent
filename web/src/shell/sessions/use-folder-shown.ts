import { useState } from "react";

const SHOWN_KEY = "sidebarFolderShown";

/** How many sessions a folder shows before "more": a folder missing from the map shows `base`. */
export function useFolderShown(base: number) {
    const [shown, setShown] = useState<Record<string, number>>(() => {
        try {
            const stored: unknown = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}");

            return typeof stored === "object" && stored !== null
                ? Object.fromEntries(
                      Object.entries(stored).filter(([, count]) => typeof count === "number"),
                  )
                : {};
        } catch {
            return {}; // reason: a value somebody edited by hand is no reason to lose the sidebar
        }
    });
    const countOf = (cwd: string): number => shown[cwd] ?? base;
    const setCount = (cwd: string, count: number): void => {
        const next = { ...shown, [cwd]: count };

        if (count === base) {
            delete next[cwd];
        }

        localStorage.setItem(SHOWN_KEY, JSON.stringify(next));
        setShown(next);
    };

    return { countOf, setCount };
}
