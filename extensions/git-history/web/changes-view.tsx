import type { CodeViewHandle } from "@pierre/diffs/react";
import { lazy, type ReactNode, type RefObject, Suspense, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert.tsx";

import { messageOf } from "../../../shared/guards.ts";
import { UNTRACKED_FILE_CAP, type Changes } from "../refs.ts";
import { cachedPatch, loadChanges } from "./patch-cache.ts";
import { PendingPane } from "./pending-pane.tsx";
import { loadPreview } from "./prefetch.ts";

const PatchPreview = lazy(async () => ({ default: (await loadPreview()).PatchPreview }));

/** One commit's changes; the diff, when it is drawn, owns the page's only scroll. */
export function ChangesView({
    session,
    target,
    header,
    viewRef,
    open,
    reread,
}: {
    session: number;
    target: string;
    header: ReactNode;
    viewRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
    /** This detail is the one on screen: opening it again reads it again. */
    open: boolean;
    /** Bumped by Refresh and by a reword: the commit it names comes back from the cache. */
    reread: number;
}) {
    const [data, setData] = useState<Changes | null>(() => cachedPatch(session, target) ?? null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        // A detail kept offscreen under the list reads nothing; the commit comes back from the cache,
        // but the working tree has changed under the page, so opening it again reads it again.
        if (!open) {
            return undefined;
        }
        let alive = true;
        void (async () => {
            try {
                const found = await loadChanges(session, target);
                if (alive) {
                    setData(found);
                }
            } catch (failure) {
                if (alive) {
                    setError(messageOf(failure));
                }
            }
        })();
        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh reads the shown target again
    }, [session, target, open, reread]);
    if (error !== null) {
        return (
            <PendingPane header={header}>
                <Alert className="text-interface p-3">{error}</Alert>
            </PendingPane>
        );
    }
    if (data === null) {
        return (
            <PendingPane header={header}>
                <p className="text-muted p-3">Reading changes…</p>
            </PendingPane>
        );
    }
    const withSummary = (
        <>
            {header}
            <div className="text-meta text-muted flex flex-wrap gap-3">
                <span>
                    {data.files.length} {data.files.length === 1 ? "file" : "files"}
                </span>
                <span className="text-ok">
                    +{data.files.reduce((sum, file) => sum + file.added, 0)}
                </span>
                <span className="text-danger">
                    −{data.files.reduce((sum, file) => sum + file.deleted, 0)}
                </span>
            </div>
            {data.truncated ? (
                <p className="text-warn text-meta">
                    Preview stops at 400 KiB and {UNTRACKED_FILE_CAP} new files: files that fit keep
                    their diff, the rest are listed without one.
                </p>
            ) : null}
            {data.files.length === 0 ? <p className="text-meta text-muted">No changes.</p> : null}
        </>
    );
    return (
        <Suspense
            fallback={
                <PendingPane header={withSummary}>
                    <p className="text-muted p-3">Reading the diff…</p>
                </PendingPane>
            }
        >
            <PatchPreview data={data} header={withSummary} viewRef={viewRef} />
        </Suspense>
    );
}
