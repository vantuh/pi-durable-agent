import { useSyncExternalStore } from "react";

import { callAction } from "../../web/src/sdk/actions.ts";
import { listTodos, type Todo } from "./refs.ts";

// What the panel and the header badge share: each session's to-dos, as far as they are read. The badge counts the
// open ones from the same list the panel shows.
const lists = new Map<number, Todo[]>();
/** Changes the panel has sent whose answers are still to come, per session. */
const pending = new Map<number, number>();
const listeners = new Set<() => void>();

const notify = (): void => {
    for (const listener of listeners) {
        listener();
    }
};

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
};

export function setTodos(session: number, todos: Todo[]): void {
    lists.set(session, todos);
    notify();
}

/** Shows a change before the server confirms it; nothing happens while the list is unread. */
export function changeTodos(session: number, local: (todos: Todo[]) => Todo[]): void {
    const current = lists.get(session);

    if (current !== undefined) {
        setTodos(session, local(current));
    }
}

/** The session's to-dos, or undefined until they are read. */
export const todosOf = (session: number | null): Todo[] | undefined =>
    session === null ? undefined : lists.get(session);

/** How many of the session's to-dos are open. */
export const countOf = (session: number | null): number =>
    todosOf(session)?.filter((todo) => !todo.done).length ?? 0;

export const useTodos = (session: number | null): Todo[] | undefined =>
    useSyncExternalStore(subscribe, () => todosOf(session));

export const useCount = (session: number | null): number =>
    useSyncExternalStore(subscribe, () => countOf(session));

export const pendingChanges = (session: number): number => pending.get(session) ?? 0;

export function countChange(session: number, by: 1 | -1): void {
    pending.set(session, pendingChanges(session) + by);
}

/** Reads the list from the server. A change still on its way would be undone on screen by this older list, so then it is dropped. */
export async function refreshTodos(session: number): Promise<void> {
    const todos = await callAction(listTodos, undefined, session);

    if (todos !== null && pendingChanges(session) === 0) {
        setTodos(session, todos);
    }
}

let lastFlush: Promise<void> = Promise.resolve();

/** Records a save that is still running, so a read of the same note can wait for it. */
export function trackFlush(save: Promise<void>): void {
    lastFlush = save.catch(() => undefined);
}

/** Resolves once the latest tracked save has settled; never rejects. */
export const flushed = (): Promise<void> => lastFlush;
