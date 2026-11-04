import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionRef } from "../../../shared/extension-api.ts";
import { callAction } from "./actions.ts";

/** What a switch's actions answer with. */
export type Switched = { on: boolean };

const RETRY_MS = 5_000;
/** Automatic tries per session: an unreachable server does not need a permanent poll. */
const ATTEMPTS = 3;

/**
 * A per-session on/off switch kept by an extension's server half: `state` reads it, `set` writes it.
 * The value is null until the server has answered. A reading is made when the session opens or
 * changes, and again by `read` (a popover opening: another tab runs the same switch); a session that
 * has never answered gets a few bounded tries. `toggle` saves, then settles on what the server holds.
 */
export function useBooleanAction(
    id: number | null,
    state: ActionRef<undefined, Switched>,
    set: ActionRef<{ on: boolean }, Switched>,
): { mode: Switched | null; read: () => Promise<boolean>; toggle: (on: boolean) => void } {
    const [mode, setMode] = useState<Switched | null>(null);
    /** Which session the retries below were spent on; another session starts from zero. */
    const [retries, setRetries] = useState<{ session: number | null; count: number }>({
        session: null,
        count: 0,
    });
    /** The newest reading or toggle: an older answer arriving late is dropped, not shown. */
    const latest = useRef(0);
    /** Saves in flight: a reading that starts while one runs sees the value from before it. */
    const pending = useRef(0);
    const spent = retries.session === id ? retries.count : 0;

    const read = useCallback(async (): Promise<boolean> => {
        if (id === null) {
            return true;
        }

        const token = latest.current + 1;

        latest.current = token;

        try {
            const next = await callAction(state, undefined, id);

            // Stale when a newer reading or toggle started after it, and when a save is running: the server
            // still holds the value from before that save.
            if (latest.current === token && pending.current === 0) {
                setMode(next);
            }

            return true;
        } catch {
            return false;
        }
    }, [id, state]);

    useEffect(() => {
        let retry: ReturnType<typeof setTimeout> | undefined;

        // oxlint-disable-next-line react/set-state-in-effect -- read() sets state after its await, not during the effect
        void read().then((ok) => {
            if (ok) {
                if (spent > 0) {
                    setRetries({ session: id, count: 0 });
                }

                return undefined;
            }

            if (spent + 1 < ATTEMPTS) {
                retry = setTimeout(() => {
                    setRetries({ session: id, count: spent + 1 });
                }, RETRY_MS);
            }

            return undefined;
        });

        return () => {
            clearTimeout(retry);
        };
    }, [id, read, spent]);

    const toggle = (on: boolean): void => {
        // A toggle outranks every reading already in flight, including the one its own save would cause.
        latest.current += 1;

        const token = latest.current;

        pending.current += 1;
        void (async () => {
            try {
                const next = await callAction(set, { on }, id);

                if (latest.current === token) {
                    setMode(next);
                }
            } catch {
                // A failure leaves the switch as it was.
            } finally {
                pending.current -= 1;
                // Settle on what the server stored, after a success and after a failure alike.
                await read();
            }
        })();
    };

    return { mode, read, toggle };
}
