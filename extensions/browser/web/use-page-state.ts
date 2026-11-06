import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { messageOf } from "../../../shared/guards.ts";
import { type BrowserState, type Control, control, state } from "../refs.ts";

/** The page's state, read once a second while the panel is open; `set` takes the answer of a control. */
export function usePageState(id: number | null) {
    const [page, set] = useState<BrowserState | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (id === null) {
            return undefined;
        }

        let alive = true;
        const read = async (): Promise<void> => {
            try {
                const next = await callAction(state, undefined, id);

                if (alive) {
                    set(next);
                    setError(null);
                }
            } catch (failure) {
                if (alive) {
                    setError(messageOf(failure));
                }
            }
        };

        void read();
        const timer = setInterval(() => void read(), 1000);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [id]);

    const run = async (what: Control): Promise<void> => {
        if (id === null) {
            return;
        }

        try {
            set(await callAction(control, what, id));
            setError(null);
        } catch (failure) {
            setError(messageOf(failure));
        }
    };

    return { page, error, setError, run };
}
