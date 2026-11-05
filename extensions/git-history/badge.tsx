import { ArrowDown, ArrowUp, GitCompareArrows, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { callAction } from "@/sdk/actions.ts";
import { useShellCommand } from "@/sdk/commands.ts";
import type { HeaderItemProps } from "@/sdk/types.ts";
import { CommandKeys } from "@/ui/command-keys.tsx";

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

    // The header is always mounted, so the page it belongs to is reachable by a key from the chat too.
    useShellCommand("extension.git-history.open", () => {
        if (session !== null) {
            openPage(HISTORY_PAGE);
        }
    });

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
    // `?? null` keeps a stats object one live edit older than this file from reading `undefined.ahead`.
    const worktree = value.worktree ?? null;
    const canPush = value.upstream !== null && value.ahead > 0 && value.behind === 0;
    const compare: { ahead: number; behind: number } | null =
        worktree ?? (value.upstream === null ? null : value);
    const changesLabel = `${String(value.added)} added, ${String(value.deleted)} deleted lines`;
    const remoteLabel =
        value.upstream === null
            ? "No upstream configured"
            : `${String(value.ahead)} unpushed, ${String(value.behind)} incoming commits vs ${value.upstream} (last fetch)`;
    const commitsLabel =
        worktree === null
            ? remoteLabel
            : `${String(worktree.ahead)} own, ${String(worktree.behind)} missing commits vs the main checkout's ${worktree.base} (local refs, no fetch)`;
    const description = `${changesLabel} (staged, unstaged and untracked; binary files excluded). ${commitsLabel}.${worktree !== null && value.upstream !== null ? ` Push uses ${remoteLabel}.` : ""}`;

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
                {/* One target, so one highlight: the diff while there is one (its Back leads to the list), else the list. */}
                <Hint
                    label="Git history"
                    keys={<CommandKeys command="extension.git-history.open" />}
                >
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Git history: ${changesLabel}. ${commitsLabel}`}
                        className="-ml-1.5 h-5 gap-2 px-1.5 py-0"
                        onClick={() => {
                            openPage(
                                HISTORY_PAGE,
                                value.added + value.deleted > 0 ? WORKING : undefined,
                            );
                        }}
                    >
                        <GitCompareArrows className="hidden size-3.5 sm:block" />
                        <span className="text-ok">+{value.added}</span>
                        <span className="text-danger">−{value.deleted}</span>
                        <span className="border-edge flex items-center gap-1 border-l pl-2">
                            <span
                                className={`flex items-center gap-1 ${(compare?.ahead ?? 0) > 0 ? "text-warn" : ""}`}
                            >
                                <ArrowUp className="size-3" />
                                {compare === null ? "?" : compare.ahead}
                            </span>
                            <span
                                className={`flex items-center gap-1 ${(compare?.behind ?? 0) > 0 ? "text-danger-deep" : ""}`}
                            >
                                <ArrowDown className="size-3" />
                                {compare === null ? "?" : compare.behind}
                            </span>
                        </span>
                    </Button>
                </Hint>
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
                        size="sm"
                        className="mt-3 font-normal"
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
