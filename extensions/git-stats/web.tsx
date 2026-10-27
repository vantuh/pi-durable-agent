import { ArrowDown, ArrowUp, GitCompareArrows, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { push, stats, type GitStats } from "./refs.ts";

function GitBadge({ session }: StatusProps) {
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
                    setIssue(error instanceof Error ? error.message : String(error));
                }
            }
            if (alive) {
                timer = setTimeout(() => {
                    void update();
                }, 10000);
            }
        };
        void update();
        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- refresh on agent activity and after a push, in addition to polling
    }, [id, busy, refresh]);

    if (id === null || data?.id !== id) {
        return null;
    }
    const value = data.stats;
    const canPush = value.upstream !== null && value.ahead > 0 && value.behind === 0;
    const description = `${String(value.added)} added, ${String(value.deleted)} deleted lines (staged, unstaged and untracked; binary files excluded). ${value.upstream === null ? "No upstream configured." : `${String(value.ahead)} unpushed, ${String(value.behind)} incoming commits vs ${value.upstream} (last fetch).`}`;

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
            setIssue(error instanceof Error ? error.message : String(error));
        } finally {
            setPushing(false);
            setRefresh((previous) => previous + 1);
        }
    }

    return (
        <div className="relative">
            <div
                title={description}
                aria-label={description}
                className="border-edge bg-panel text-meta text-muted flex h-7 items-center gap-2 rounded-full border px-2 font-mono tabular-nums"
            >
                <GitCompareArrows className="hidden size-3.5 sm:block" />
                <span className="text-ok">+{value.added}</span>
                <span className="text-danger">−{value.deleted}</span>
                <span className="border-edge flex items-center gap-1 border-l pl-2">
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
                </span>
                <button
                    type="button"
                    disabled={!canPush || pushing}
                    title={
                        canPush
                            ? "Push commits"
                            : "Push needs an upstream, unpushed commits and no incoming commits"
                    }
                    onClick={() => {
                        setConfirm(true);
                    }}
                    className="border-edge text-accent hover:bg-raised -mr-1 flex h-5 items-center gap-1 rounded-full border px-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {pushing ? (
                        <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                        <ArrowUp className="size-3" />
                    )}
                    <span className="hidden sm:inline">Push</span>
                </button>
            </div>
            {confirm || issue !== null ? (
                <div
                    className="border-edge bg-panel text-interface absolute top-9 right-0 z-30 w-64 rounded-xl border p-3 shadow-lg"
                    role={issue === null ? "dialog" : "alert"}
                    aria-label="Git push"
                >
                    <div className="flex items-start justify-between gap-2">
                        <p className={issue === null ? "text-ink" : "text-danger"}>
                            {issue ??
                                `Push ${String(value.ahead)} commit(s) to ${value.upstream ?? "upstream"}?`}
                        </p>
                        <button
                            type="button"
                            aria-label="Close Git message"
                            className="text-muted shrink-0"
                            onClick={() => {
                                setConfirm(false);
                                setIssue(null);
                            }}
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                    {confirm ? (
                        <button
                            type="button"
                            className="bg-accent text-on-accent mt-3 rounded-full px-3 py-1"
                            onClick={() => {
                                void doPush();
                            }}
                        >
                            Push commits
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

// Reset local state when switching conversations, including an open confirmation/error.
function Item({ session }: StatusProps) {
    return <GitBadge key={session?.id ?? "none"} session={session} />;
}

export default { header: [{ id: "stats", component: Item }] } satisfies WebExtension;
