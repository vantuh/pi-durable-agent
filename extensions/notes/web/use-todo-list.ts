import { useCallback, useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import type { ActionRef } from "../../../shared/extension-api.ts";
import { listTodos, type Todo } from "../refs.ts";
import {
    changeTodos,
    countChange,
    pendingChanges,
    refreshTodos,
    setTodos,
    useTodos,
} from "./store.ts";

const messageOf = (failure: unknown, fallback: string): string =>
    failure instanceof Error ? failure.message : fallback;

/**
 * The repository's to-dos. A change shows at once and goes to the server after the ones before it,
 * so an undo never overtakes its removal; the answer replaces the list once nothing else is waiting.
 * A change the server refuses shows its error and re-reads the list.
 */
export function useTodoList(id: number) {
    const items = useTodos(id) ?? null;
    const [error, setError] = useState<string | null>(null);
    const queue = useRef<Promise<unknown>>(Promise.resolve());

    const reload = useCallback(async (): Promise<void> => {
        try {
            const todos = await callAction(listTodos, undefined, id);

            if (todos !== null) {
                setTodos(id, todos);
            }
        } catch (failure) {
            setError(messageOf(failure, "The to-dos could not be read."));
        }
    }, [id]);

    const run = useCallback(
        async <Args>(
            ref: ActionRef<Args, Todo[]>,
            args: Args,
            local: (todos: Todo[]) => Todo[],
        ): Promise<void> => {
            changeTodos(id, local);
            countChange(id, 1);

            const sent = queue.current.then(() => callAction(ref, args, id));

            queue.current = sent.catch(() => undefined);

            try {
                const todos = await sent;

                if (pendingChanges(id) === 1) {
                    setTodos(id, todos);
                }

                setError(null);
            } catch (failure) {
                setError(messageOf(failure, "The to-dos were not saved."));
                await reload();
            } finally {
                countChange(id, -1);
            }
        },
        [id, reload],
    );

    useEffect(() => {
        let alive = true;
        const refresh = async (): Promise<void> => {
            try {
                await refreshTodos(id);
            } catch (failure) {
                if (alive) {
                    setError(messageOf(failure, "The to-dos could not be read."));
                }
            }
        };
        const onFocus = (): void => {
            void refresh();
        };

        void refresh();
        window.addEventListener("focus", onFocus);

        return () => {
            alive = false;
            window.removeEventListener("focus", onFocus);
        };
    }, [id]);

    return { items, error, run };
}
