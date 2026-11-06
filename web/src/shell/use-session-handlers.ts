import { useCallback } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import {
    createSession,
    deleteSession,
    listSessions,
    setSessionArchived,
    setSessionTitle,
} from "../lib/api.ts";
import { restoreComposerFocus } from "../sdk/composer.ts";

/** What the sidebar and the model menu do to the session list, and where they take the person afterwards. */
export function useSessionHandlers({
    current,
    go,
    setSessions,
    closeSheet,
}: {
    current: number | null;
    go: (session: number | null) => void;
    setSessions: (
        update: SessionSummary[] | ((rows: SessionSummary[]) => SessionSummary[]),
    ) => void;
    closeSheet: () => void;
}) {
    // The stream catches up a moment later; an action's own result is shown at once.
    const reload = useCallback(async (): Promise<void> => {
        setSessions(await listSessions());
    }, [setSessions]);
    const select = useCallback(
        (id: number | null) => {
            go(id);
            closeSheet();

            // The same session is not mounted again, so the composer's own focus on mount does not run.
            if (id === current) {
                restoreComposerFocus("close");
            }
        },
        [go, current, closeSheet],
    );
    const home = useCallback(() => {
        select(null);
    }, [select]);
    const archive = useCallback(
        async (id: number, archived: boolean) => {
            await setSessionArchived(id, archived);
            setSessions((rows) => rows.map((row) => (row.id === id ? { ...row, archived } : row)));
        },
        [setSessions],
    );
    const remove = useCallback(
        async (id: number) => {
            await deleteSession(id);
            setSessions((rows) => rows.filter((row) => row.id !== id));

            if (id === current) {
                go(null);
            }
        },
        [setSessions, current, go],
    );
    const rename = useCallback(
        async (id: number, name: string) => {
            await setSessionTitle(id, name);
            setSessions(await listSessions());
        },
        [setSessions],
    );

    // A new session in `path`, opened at once.
    const openSession = useCallback(
        (path: string): void => {
            void (async () => {
                const id = await createSession(path);

                if (id !== 0) {
                    go(id);
                    closeSheet();
                }

                await reload();
            })();
        },
        [go, reload, closeSheet],
    );

    return { reload, select, home, archive, remove, rename, openSession };
}
