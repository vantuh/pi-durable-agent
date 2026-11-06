/** The browser's one reader and writer of the MCP state, shared by the status item and the settings details. */
import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { type McpState, state, toggle } from "../refs.ts";

/**
 * The servers from mcp.json. With `refreshMs` the state is read again on that timer, since a server may still be
 * connecting when the page opens; without it, once. Nothing is read while `active` is false. A read that fails keeps
 * the last known state on screen, and `error` says so only while there is none. `change` switches one server and
 * reports why it could not.
 */
export function useMcp({
    active = true,
    refreshMs,
}: { active?: boolean; refreshMs?: number } = {}) {
    const [current, setCurrent] = useState<McpState | undefined>();
    const [busy, setBusy] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        let alive = true;
        let loaded = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const update = async (): Promise<void> => {
            try {
                const found = await callAction(state, undefined, null);

                if (alive) {
                    if (!loaded) {
                        loaded = true;
                        setError(undefined);
                    }

                    setCurrent(found);
                }
            } catch (failure) {
                if (alive && !loaded) {
                    setError(
                        failure instanceof Error ? failure.message : "Cannot read the servers.",
                    );
                }
            }

            if (alive && refreshMs !== undefined) {
                timer = setTimeout(() => {
                    void update();
                }, refreshMs);
            }
        };

        void update();

        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [active, refreshMs]);

    const change = async (name: string, enabled: boolean): Promise<void> => {
        setBusy(name);
        setError(undefined);

        try {
            setCurrent(await callAction(toggle, { name, enabled }, null));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Something went wrong.");
        } finally {
            setBusy(undefined);
        }
    };

    return { current, busy, error, change };
}
