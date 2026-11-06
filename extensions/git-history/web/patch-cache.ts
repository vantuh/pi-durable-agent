import { callAction } from "@/sdk/actions.ts";

import { changes, type Changes } from "../refs.ts";

/** A commit's diff never changes, so reopening it is free; only the working tree is read each time. */
const patches = new Map<string, Changes>();
const pendingPatches = new Map<string, Promise<Changes>>();
const PATCHES_KEPT = 20;

const patchKey = (session: number, target: string): string => `${String(session)}:${target}`;

export function cachedPatch(session: number, target: string): Changes | undefined {
    return patches.get(patchKey(session, target));
}

/** A second click waits for the request already in flight rather than starting its own. */
export function loadChanges(session: number, target: string): Promise<Changes> {
    if (target === "worktree") {
        return callAction(changes, { target }, session);
    }
    const found = cachedPatch(session, target);
    if (found !== undefined) {
        return Promise.resolve(found);
    }
    const key = patchKey(session, target);
    const pending = pendingPatches.get(key);
    if (pending !== undefined) {
        return pending;
    }
    const request = callAction(changes, { target }, session)
        .then((result) => {
            patches.set(key, result);
            const oldest = patches.keys().next().value;
            if (patches.size > PATCHES_KEPT && oldest !== undefined) {
                patches.delete(oldest);
            }
            return result;
        })
        .finally(() => {
            pendingPatches.delete(key);
        });
    pendingPatches.set(key, request);
    return request;
}

export function forgetPatches(): void {
    patches.clear();
}
