import { GitBranch, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { Toolbar } from "@/ui/pane.tsx";

import type { History } from "../refs.ts";
import { pageButton } from "./page-button.ts";

/** The list's toolbar: the branch, how far it is from its upstream, the running review's actions, and Refresh. */
export function HistoryToolbar({
    data,
    cwd,
    reviewing,
    loading,
    onResume,
    onCancel,
    onRefresh,
}: {
    data: History | null;
    cwd: string | null;
    /** A review is starting or running: it can be resumed or cancelled from here. */
    reviewing: boolean;
    loading: boolean;
    onResume: () => void;
    onCancel: () => void;
    onRefresh: () => void;
}) {
    return (
        <Toolbar className="min-h-9 flex-wrap">
            {/* 36px is the step the row already measured: a 16px pill in py-1.5 beside the 24px actions is 37 with its
                border, so the 35px floor this was had never bound. */}
            {data?.branch ? (
                <Badge
                    title={`${data.branch} in ${cwd ?? "this folder"}`}
                    className="h-4 max-w-36 min-w-0 shrink px-1.5 [&>svg]:size-2.5"
                >
                    <GitBranch />
                    <span className="truncate">{data.branch}</span>
                </Badge>
            ) : null}
            {data?.upstream ? (
                <Badge className="h-4 px-1.5" title={`${data.upstream} as of the last fetch`}>
                    {`↑${String(data.ahead)} ↓${String(data.behind)}`}
                </Badge>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-2">
                {reviewing ? (
                    <>
                        <Button variant="ghost" className={pageButton} onClick={onResume}>
                            Resume review
                        </Button>
                        <Button variant="ghost" className={pageButton} onClick={onCancel}>
                            Cancel review
                        </Button>
                    </>
                ) : null}
                <Hint label="Refresh history">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Refresh history"
                        disabled={loading}
                        className="disabled:opacity-40"
                        onClick={onRefresh}
                    >
                        <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </Hint>
            </div>
        </Toolbar>
    );
}
