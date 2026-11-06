import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { messageOf } from "../../../shared/guards.ts";
import { commitMeta, history, type History } from "../refs.ts";
import { forgetPatches } from "./patch-cache.ts";
import { actionTarget } from "./place.ts";
import { prefetch, PREFETCHED, whenIdle } from "./prefetch.ts";
import type { Looked } from "./shown.ts";

/**
 * The loaded page of history, and the message of a commit the page stops short of, read on its own.
 * `reload` reads everything again; `loadMore` asks for 50 older commits.
 */
export function useHistory(
    id: number,
    shownTarget: string | undefined,
    setIssue: (issue: string | null) => void,
) {
    const [data, setData] = useState<History | null>(null);
    const [limit, setLimit] = useState(50);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    // The message of a commit the loaded page of history stops short of, or an abbreviated sha's full one.
    const [looked, setLooked] = useState<Looked | null>(null);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const found = await callAction(history, { limit }, id);
                if (alive) {
                    setData(found);
                    setIssue(null);
                }
            } catch (error) {
                if (alive) {
                    setIssue(messageOf(error));
                }
            } finally {
                if (alive) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh explicitly reloads the same Git query
    }, [id, limit, refresh, setIssue]);

    // A link can name a commit the loaded list does not hold, or abbreviate the sha: its message is read
    // on its own, since the diff under it is read from the same target anyway.
    useEffect(() => {
        if (shownTarget === undefined || actionTarget(shownTarget) === "worktree") {
            return undefined;
        }
        if (data === null || data.commits.some((each) => each.hash === shownTarget)) {
            return undefined;
        }
        if (looked !== null && looked.target === shownTarget) {
            return undefined;
        }
        let alive = true;
        void (async () => {
            try {
                const commit = await callAction(commitMeta, { target: shownTarget }, id);
                if (alive) {
                    setLooked(
                        commit === null
                            ? { target: shownTarget, kind: "missing" }
                            : { target: shownTarget, kind: "commit", commit },
                    );
                }
            } catch (error) {
                if (alive) {
                    setLooked({ target: shownTarget, kind: "error", error: messageOf(error) });
                }
            }
        })();
        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a refresh cancels the answer already on its way
    }, [id, shownTarget, data, looked, refresh]);

    // The newest commits are the ones opened next: read them while nobody is waiting.
    useEffect(() => {
        if (data === null) {
            return undefined;
        }
        let alive = true;
        let stop: () => void = () => undefined;
        const warm = async (index: number): Promise<void> => {
            const commit = data.commits[index];
            if (!alive || commit === undefined || index >= PREFETCHED) {
                return;
            }
            await prefetch(id, commit.hash).catch(() => undefined);
            if (alive) {
                stop = whenIdle(() => {
                    void warm(index + 1);
                });
            }
        };
        stop = whenIdle(() => {
            void warm(0);
        });
        return () => {
            alive = false;
            stop();
        };
    }, [id, data]);

    // A read that failed, and a commit a reword moved, are both read again here.
    function reload(): void {
        setLoading(true);
        forgetPatches();
        setLooked(null);
        setRefresh((value) => value + 1);
    }

    function loadMore(): void {
        setLoading(true);
        setLimit((value) => Math.min(200, value + 50));
    }

    return { data, limit, refresh, loading, looked, reload, loadMore };
}
