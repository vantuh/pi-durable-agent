import type { RefObject } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { ago } from "@/lib/time.ts";

import { WORKING, type History } from "../refs.ts";
import { HistoryRow } from "./history-row.tsx";
import { pageButton } from "./page-button.ts";
import { prefetchSoon } from "./prefetch.ts";

/** The list's scroll: the working tree first when it has changes, then the commits, then "Load older". */
export function HistoryList({
    id,
    data,
    issue,
    loading,
    limit,
    now,
    viewed,
    seen,
    rows,
    onUnread,
    onOpen,
    onMore,
}: {
    id: number;
    data: History | null;
    issue: string | null;
    loading: boolean;
    limit: number;
    now: number;
    /** The row the list rings. */
    viewed: string | null;
    seen: ReadonlySet<string>;
    /** The buttons of the rows, by target, for the page's keyboard. */
    rows: RefObject<Map<string, HTMLButtonElement>>;
    onUnread: (target: string) => void;
    onOpen: (target: string) => void;
    onMore: () => void;
}) {
    const rowRef = (target: string) => (element: HTMLButtonElement | null) => {
        if (element === null) {
            rows.current.delete(target);
        } else {
            rows.current.set(target, element);
        }
    };

    return (
        <ScrollArea type="always" className="min-h-0 flex-1">
            {issue !== null ? (
                <Alert className="text-interface border-edge-soft border-b">{issue}</Alert>
            ) : null}
            {data === null && loading ? (
                <p className="text-muted p-4">Reading Git history…</p>
            ) : null}
            {data !== null ? (
                <>
                    <ol>
                        {data.changes > 0 ? (
                            <HistoryRow
                                target={WORKING}
                                title="Uncommitted changes"
                                detail={`${String(data.changes)} files changed · live Git review`}
                                at={undefined}
                                marker={undefined}
                                viewed={viewed === WORKING}
                                seen={seen.has(WORKING)}
                                onUnread={onUnread}
                                onOpen={onOpen}
                                onPrefetch={(target) => {
                                    prefetchSoon(id, target);
                                }}
                                rowRef={rowRef(WORKING)}
                            />
                        ) : null}
                        {data.commits.map((each) => (
                            <HistoryRow
                                key={each.hash}
                                target={each.hash}
                                title={each.subject || "(no message)"}
                                detail={`${each.short} · ${each.author} · ${ago(each.at, now)}`}
                                at={each.at}
                                marker={
                                    each.remote ? "remote" : each.unpushed ? "local" : undefined
                                }
                                viewed={viewed === each.hash}
                                seen={seen.has(each.hash)}
                                onUnread={onUnread}
                                onOpen={onOpen}
                                onPrefetch={(target) => {
                                    prefetchSoon(id, target);
                                }}
                                rowRef={rowRef(each.hash)}
                            />
                        ))}
                    </ol>
                    {data.commits.length === 0 && data.changes === 0 ? (
                        <Empty className="text-muted text-interface p-4">
                            No commits or uncommitted changes yet.
                        </Empty>
                    ) : null}
                    {data.more ? (
                        <div className="p-3">
                            <Button
                                variant="ghost"
                                className={pageButton}
                                disabled={limit >= 200 || loading}
                                onClick={onMore}
                            >
                                {limit >= 200
                                    ? "Showing the newest 200 commits"
                                    : "Load older commits"}
                            </Button>
                        </div>
                    ) : null}
                </>
            ) : null}
        </ScrollArea>
    );
}
