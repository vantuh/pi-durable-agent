import { ArrowDown, ArrowUp, GitCompareArrows, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import type { HeaderItemProps } from "@/sdk/types.ts";

import { messageOf } from "../../shared/guards.ts";
import { HISTORY_PAGE, push, stats, WORKING, type GitStats } from "./refs.ts";

// The server watches the working tree and bumps `session.revision` on a change (the effect below re-reads on that), so
// this slow poll is only the heartbeat that keeps the server watching, and a hidden tab, which a phone keeps for
// hours, is not worth waking the radio for.
const POLL_MS = 60_000;

function GitBadge({ session, openPage }: HeaderItemProps) {
    const id = session?.id ?? null;
    const busy = session?.busy ?? false;
    const [data, setData] = useState<{ id: number; stats: GitStats } | null>(null);
    const [issue, setIssue] = useState<string | null>(null);
    const [pushing, setPushing] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [confirm, setConfirm] = useState(false);

    useEffect(() => {
        if (id === null) {
            return undefined;
        }
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const update = async () => {
            try {
                const found = await callAction(stats, undefined, id);
                if (alive) {
                    setData(found === null ? null : { id, stats: found });
                }
            } catch (error) {
                if (alive) {
                    setIssue(messageOf(error));
                }
            }
            if (alive) {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (document.visibilityState === "visible") {
                        void update();
                    }
                }, POLL_MS);
            }
        };
        const onVisible = () => {
            if (document.visibilityState === "visible") {
                clearTimeout(timer);
                void update();
            }
        };
        void update();
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            alive = false;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- refresh on agent activity, a server-side change and after a push, in addition to polling
    }, [id, busy, refresh, session?.revision]);

    if (id === null || data?.id !== id) {
        return null;
    }
    const value = data.stats;
    const canPush = value.upstream !== null && value.ahead > 0 && value.behind === 0;
    const changesLabel = `${String(value.added)} added, ${String(value.deleted)} deleted lines`;
    const commitsLabel =
        value.upstream === null
            ? "No upstream configured"
            : `${String(value.ahead)} unpushed, ${String(value.behind)} incoming commits vs ${value.upstream}`;
    const description = `${changesLabel} (staged, unstaged and untracked; binary files excluded). ${commitsLabel} (last fetch).`;

    async function doPush() {
        if (id === null) {
            return;
        }
        setConfirm(false);
        setPushing(true);
        setIssue(null);
        try {
            const found = await callAction(push, undefined, id);
            setData(found === null ? null : { id, stats: found });
        } catch (error) {
            setIssue(messageOf(error));
        } finally {
            setPushing(false);
            setRefresh((previous) => previous + 1);
        }
    }

    return (
        <Popover
            open={confirm || issue !== null}
            onOpenChange={(next) => {
                if (!next) {
                    setConfirm(false);
                    setIssue(null);

                    return;
                }

                // `aria-disabled` keeps the hint a disabled button could never show, so the guard is here.
                if (!canPush || pushing) {
                    return;
                }

                setConfirm(true);
            }}
        >
            <Badge title={description} className="bg-panel h-7 gap-2 tabular-nums [&>svg]:size-3.5">
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Git history"
                    className="-mx-1 hidden h-5 px-1 py-0 sm:inline-flex"
                    onClick={() => {
                        openPage(HISTORY_PAGE);
                    }}
                >
                    <GitCompareArrows className="size-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Uncommitted changes: ${changesLabel}`}
                    className="-mx-1 h-5 gap-2 px-1 py-0"
                    onClick={() => {
                        openPage(HISTORY_PAGE, WORKING);
                    }}
                >
                    <span className="text-ok">+{value.added}</span>
                    <span className="text-danger">−{value.deleted}</span>
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Git history: ${commitsLabel}`}
                    className="border-edge -mx-1 h-5 gap-1 border-l px-1 py-0 pl-2"
                    onClick={() => {
                        openPage(HISTORY_PAGE);
                    }}
                >
                    <span
                        className={`flex items-center gap-1 ${value.ahead > 0 ? "text-warn" : ""}`}
                    >
                        <ArrowUp className="size-3" />
                        {value.upstream === null ? "?" : value.ahead}
                    </span>
                    <span
                        className={`flex items-center gap-1 ${value.behind > 0 ? "text-danger-deep" : ""}`}
                    >
                        <ArrowDown className="size-3" />
                        {value.upstream === null ? "?" : value.behind}
                    </span>
                </Button>
                <Hint
                    label={
                        canPush
                            ? "Push commits"
                            : "Push needs an upstream, unpushed commits and no incoming commits"
                    }
                >
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Push commits"
                            aria-disabled={!canPush || pushing}
                            className="border-edge text-accent hover:text-accent -mr-1 h-5 gap-1 border px-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                        >
                            {pushing ? (
                                <LoaderCircle className="size-3 animate-spin" />
                            ) : (
                                <ArrowUp className="size-3" />
                            )}
                            <span className="hidden sm:inline">Push</span>
                        </Button>
                    </PopoverTrigger>
                </Hint>
            </Badge>
            <PopoverContent
                side="bottom"
                align="end"
                aria-label="Git push"
                size="panel"
                className="text-interface"
            >
                <div className="flex items-start justify-between gap-2">
                    {issue === null ? (
                        <p className="text-ink">
                            {`Push ${String(value.ahead)} commit(s) to ${value.upstream ?? "upstream"}?`}
                        </p>
                    ) : (
                        <Alert>{issue}</Alert>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Close Git message"
                        className="size-4 shrink-0 p-0 hover:bg-transparent"
                        onClick={() => {
                            setConfirm(false);
                            setIssue(null);
                        }}
                    >
                        <X className="size-4" />
                    </Button>
                </div>
                {confirm ? (
                    <Button
                        className="mt-3"
                        onClick={() => {
                            void doPush();
                        }}
                    >
                        Push commits
                    </Button>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}

// Reset local state when switching conversations, including an open confirmation/error.
export function GitStatsItem({ session, openPage }: HeaderItemProps) {
    return <GitBadge key={session?.id ?? "none"} session={session} openPage={openPage} />;
}
