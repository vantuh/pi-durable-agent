import { useCallback, useEffect, useRef, useState } from "react";

import { getFolderLayout, setFolderLayout } from "@/lib/api.ts";
import { toast } from "@/lib/toast.ts";

import type { FolderLayout, FolderLook } from "../../../../shared/folders.ts";

const EMPTY: FolderLayout = { order: [], collapsed: [], folders: {} };

/**
 * The sidebar's folder order, folds, names and colours, kept on the server. It is read again whenever the tab
 * comes back to the front, so a change made on the phone shows on the computer.
 */
export function useFolderLayout() {
    const [layout, setLayout] = useState(EMPTY);
    // The stored layout is here: a change made before it would save over everything kept on the server.
    const held = useRef<FolderLayout | null>(null);

    useEffect(() => {
        const read = async (): Promise<void> => {
            // reason: the list still draws, and the next return to the tab reads again
            const stored = await getFolderLayout().catch(() => null);

            if (stored !== null) {
                held.current = stored;
                setLayout(stored);
            }
        };
        const back = (): void => {
            if (document.visibilityState === "visible") {
                void read();
            }
        };

        void read();
        document.addEventListener("visibilitychange", back);

        return () => {
            document.removeEventListener("visibilitychange", back);
        };
    }, []);

    const change = useCallback((make: (layout: FolderLayout) => FolderLayout): void => {
        if (held.current === null) {
            return;
        }

        const next = make(held.current);

        held.current = next;
        setLayout(next);
        void setFolderLayout(next).catch(() => {
            toast.error("Could not save the folder layout.");
        });
    }, []);

    const setOrder = useCallback(
        (order: string[]): void => {
            change((current) => ({ ...current, order }));
        },
        [change],
    );
    const toggleFold = useCallback(
        (cwd: string): void => {
            change((current) => ({
                ...current,
                collapsed: current.collapsed.includes(cwd)
                    ? current.collapsed.filter((entry) => entry !== cwd)
                    : [...current.collapsed, cwd],
            }));
        },
        [change],
    );
    /** A field given as `undefined` is cleared; a folder left with neither keeps no entry. */
    const setLook = useCallback(
        (cwd: string, patch: FolderLook): void => {
            change((current) => {
                const look: FolderLook = { ...current.folders[cwd], ...patch };
                const folders = { ...current.folders, [cwd]: look };

                if (look.name === undefined && look.color === undefined) {
                    delete folders[cwd];
                }

                return { ...current, folders };
            });
        },
        [change],
    );

    return { layout, setOrder, toggleFold, setLook };
}
