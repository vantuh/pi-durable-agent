import { useSyncExternalStore } from "react";

import { callAction } from "@/sdk/actions.ts";

import { type FolderTabs, type Tab, folders } from "../refs.ts";

// shortcut: every folder header reads one list polled every 3 s while the page is shown; push it over the
// session list's stream if the sidebar ever needs to be quicker.
const POLL_MS = 3000;
const NONE: readonly Tab[] = [];

let current: readonly FolderTabs[] = [];
let seen = "[]";
let polling = false;
const listeners = new Set<() => void>();

async function poll(): Promise<void> {
    if (!document.hidden) {
        try {
            const next = await callAction(folders, undefined, null);
            const text = JSON.stringify(next);

            // An unchanged answer keeps its identity, so no folder header re-renders for nothing.
            if (text !== seen) {
                seen = text;
                current = next;

                for (const listener of listeners) {
                    listener();
                }
            }
        } catch {
            // The count is a hint: the next poll tries again.
        }
    }

    if (listeners.size === 0) {
        polling = false;

        return;
    }

    setTimeout(() => {
        void poll();
    }, POLL_MS);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    if (!polling) {
        polling = true;
        void poll();
    }

    return () => {
        listeners.delete(listener);
    };
}

/** Every folder that has a terminal tab; none while the first answer is out. */
export function useAllFolderTabs(): readonly FolderTabs[] {
    return useSyncExternalStore(subscribe, () => current);
}

/** The terminal tabs of one folder, oldest first; none while the first answer is out. */
export function useFolderTabs(cwd: string): readonly Tab[] {
    return useAllFolderTabs().find((entry) => entry.cwd === cwd)?.tabs ?? NONE;
}
