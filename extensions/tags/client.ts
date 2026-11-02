/**
 * The browser's copy of the tag state: the settings form and every row marker read the same one, so
 * a tag made in the settings shows on the rows at once. It is read again when the page is shown,
 * which is how a change made on another device arrives; an action's answer replaces it whole.
 */
import { useEffect, useSyncExternalStore } from "react";

import { callAction } from "../../web/src/sdk/actions.ts";
import {
    create as createAction,
    recolor as recolorAction,
    rename as renameAction,
    remove as removeAction,
    state as stateAction,
    toggle as toggleAction,
    type TagColor,
    type TagsState,
} from "./refs.ts";

let current: TagsState | undefined;
let loading: Promise<void> | undefined;
let unwatch: (() => void) | undefined;
/** Bumped when a change is sent, so a read that started before it cannot land on top of it. */
let sent = 0;
/** Bumped by every publish, so a read cannot land on top of an answer that came after it started. */
let published = 0;
const listeners = new Set<() => void>();

function publish(next: TagsState): void {
    published += 1;
    current = next;

    for (const listener of listeners) {
        listener();
    }
}

/** Reads the server's copy; callers waiting on the same read share it. */
export function load(): Promise<void> {
    if (loading !== undefined) {
        return loading;
    }

    const startedSent = sent;
    const startedPublished = published;

    loading = (async () => {
        try {
            const next = await callAction(stateAction, undefined, null);

            // A change was sent, or a fresher answer published, while this read was out.
            if (sent === startedSent && published === startedPublished) {
                publish(next);
            }
        } finally {
            loading = undefined;
        }
    })();

    return loading;
}

/** A change made on another device is noticed when this one comes back to the page. */
function watch(): () => void {
    const again = (): void => {
        void load().catch(() => undefined);
    };
    const shown = (): void => {
        if (!document.hidden) {
            again();
        }
    };

    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", shown);

    return () => {
        window.removeEventListener("focus", again);
        document.removeEventListener("visibilitychange", shown);
    };
}

function subscribe(listener: () => void): () => void {
    unwatch ??= watch();
    listeners.add(listener);

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            unwatch?.();
            unwatch = undefined;
        }
    };
}

export function snapshot(): TagsState | undefined {
    return current;
}

/** The tags as the server last said them, read once more on mount; undefined until the first answer. */
export function useTags(): TagsState | undefined {
    useEffect(() => {
        void load().catch(() => undefined);
    }, []);

    return useSyncExternalStore(subscribe, snapshot);
}

/**
 * A read that starts now, after any read already out has settled: one that was out before a change
 * is discarded by its own guards, so joining it would leave nothing new to show.
 */
function reload(): void {
    const running = loading;

    void (async () => {
        await running?.catch(() => undefined);
        await load().catch(() => undefined);
    })();
}

/**
 * A change is answered whole, and only lands if no newer change was sent while it was out; a newer
 * one answers with everything this one did too, because the server runs them in order.
 */
async function mutate(work: () => Promise<TagsState>): Promise<void> {
    sent += 1;
    const mine = sent;
    let next: TagsState;

    try {
        next = await work();
    } catch (error) {
        // A change that failed may still have landed in part: read the file instead of keeping a guess.
        reload();
        throw error;
    }

    if (sent === mine) {
        publish(next);
    }
}

export async function createTag(name: string, color: TagColor): Promise<void> {
    await mutate(async () => await callAction(createAction, { name, color }, null));
}

export async function renameTag(id: string, name: string): Promise<void> {
    await mutate(async () => await callAction(renameAction, { id, name }, null));
}

export async function recolorTag(id: string, color: TagColor): Promise<void> {
    await mutate(async () => await callAction(recolorAction, { id, color }, null));
}

export async function removeTag(id: string): Promise<void> {
    await mutate(async () => await callAction(removeAction, { id }, null));
}

export async function toggleTag(tag: string, session: number): Promise<void> {
    await mutate(async () => await callAction(toggleAction, { tag }, session));
}
