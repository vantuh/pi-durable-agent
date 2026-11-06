import type { CodeViewHandle } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MINUTE } from "@/lib/time.ts";
import type { PageProps } from "@/sdk/types.ts";

import { WORKING } from "../refs.ts";
import { CommitDetail } from "./commit-detail.tsx";
import { HistoryList } from "./history-list.tsx";
import { HistoryToolbar } from "./history-toolbar.tsx";
import { heldBy, landingRow } from "./keys.ts";
import { actionTarget, placeOf, subTarget } from "./place.ts";
import { markSeen, seenCommits, setViewedCommit, unmarkSeen, viewedCommit } from "./preferences.ts";
import { reviewRunning } from "./review-running.ts";
import { ReviewView } from "./review-view.tsx";
import { detailOf } from "./shown.ts";
import { useHistory } from "./use-history.ts";
import { usePageKeys } from "./use-page-keys.ts";
import { useReview } from "./use-review.ts";

/** The Git history page: the list at its root, a commit (or the working tree) at `<target>`, a review at `<target>/review`. */
export function GitHistoryPage({ session, sub, navigate, back, close }: PageProps) {
    const id = session.id;
    const place = placeOf(sub);
    const open = place.kind !== "list";
    const [detailTarget, setDetailTarget] = useState<string | undefined>(
        place.kind === "list" ? undefined : place.target,
    );
    const openedTarget = place.kind === "list" ? undefined : place.target;
    const shownTarget = openedTarget ?? detailTarget;
    const [issue, setIssue] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    // The detail's scroller, which the page's arrows move: it lives here because the keyboard is the page's.
    const view = useRef<CodeViewHandle<undefined, undefined>>(null);
    const rows = useRef(new Map<string, HTMLButtonElement>());
    const root = useRef<HTMLDivElement>(null);
    const layer = useRef(false);
    const address = useRef(sub);
    // The folder, not the conversation: ten commits read in one chat are still the folder's progress.
    const repo = session.cwd ?? String(id);
    // The row the list rings: the detail the page keeps mounted after a return, or the one a reload stored.
    const viewed = shownTarget ?? viewedCommit(repo);
    const [seen, setSeen] = useState<ReadonlySet<string>>(() => seenCommits(repo));

    // The list says how long ago each commit landed, so the clock it counts from ticks while open.
    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);
        return () => {
            clearInterval(tick);
        };
    }, []);

    const { data, limit, refresh, loading, looked, reload, loadMore } = useHistory(
        id,
        shownTarget,
        setIssue,
    );
    const { state, starting, begin, stopReview, leaving } = useReview({
        id,
        navigate,
        close,
        setIssue,
    });

    useEffect(() => {
        address.current = sub;
    }, [sub]);

    // The list is inert under a detail; coming back to it returns the keyboard to the row that was opened.
    useEffect(() => {
        if (open) {
            layer.current = true;
            return;
        }
        if (!layer.current) {
            return;
        }
        layer.current = false;
        rows.current.get(shownTarget ?? "")?.focus();
    }, [open, shownTarget]);

    // The last detail is kept mounted offscreen when the list comes back, so the slide returns.
    const openCommit = (target: string): void => {
        setDetailTarget(target);
        setViewedCommit(repo, target);
        setSeen(markSeen(repo, target, seen));
        navigate(target);
    };

    // The rows in the order they are drawn: the working tree first when it has changes, then the commits.
    const targets = useMemo(
        () =>
            data === null
                ? []
                : [
                      ...(data.changes > 0 ? [WORKING] : []),
                      ...data.commits.map((each) => each.hash),
                  ],
        [data],
    );

    // A detail opens at its top, even when the commit was read before; another target mounts a new one.
    useEffect(() => {
        if (open) {
            view.current?.scrollTo({ type: "position", position: 0, behavior: "instant" });
        }
    }, [open]);

    // The list opens with the keyboard on a row — the one it rings, else its first — so the cursor is there
    // to move and Enter opens at once. Only the first reading lands it: a refresh, or a field the person is
    // typing in meanwhile, must not take the keyboard.
    const landed = useRef(false);
    useEffect(() => {
        if (landed.current || data === null) {
            return;
        }

        landed.current = true;

        if (open || heldBy(document.activeElement)) {
            return;
        }

        const target = landingRow(targets, viewed ?? undefined);

        if (target !== undefined) {
            rows.current.get(target)?.focus();
        }
    }, [data, open, targets, viewed]);

    usePageKeys({ where: place.kind, root, targets, rows, view, back, close });

    // A tick pressed takes its commit back out of the read list, and only out of it: the ring stays.
    const unread = (target: string): void => {
        setSeen(unmarkSeen(repo, target, seen));
    };

    const listed =
        shownTarget === undefined || actionTarget(shownTarget) === "worktree"
            ? undefined
            : data?.commits.find((candidate) => candidate.hash === shownTarget);
    const detail = shownTarget === undefined ? undefined : detailOf(shownTarget, listed, looked);

    return (
        <div ref={root} className="relative min-h-0 flex-1 overflow-hidden">
            <div
                inert={open}
                aria-hidden={open}
                className={`absolute inset-0 flex min-h-0 flex-col transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "-translate-x-full" : "translate-x-0"}`}
            >
                <HistoryToolbar
                    data={data}
                    cwd={session.cwd}
                    reviewing={reviewRunning(state)}
                    loading={loading}
                    onResume={() => {
                        if (state !== null) {
                            navigate(`${subTarget(state.target)}/review`);
                        }
                    }}
                    onCancel={() => {
                        void stopReview();
                    }}
                    onRefresh={reload}
                />
                <HistoryList
                    id={id}
                    data={data}
                    issue={issue}
                    loading={loading}
                    limit={limit}
                    now={now}
                    viewed={viewed}
                    seen={seen}
                    rows={rows}
                    onUnread={unread}
                    onOpen={openCommit}
                    onMore={loadMore}
                />
            </div>

            <div
                inert={!open}
                aria-hidden={!open}
                className={`bg-canvas absolute inset-0 flex min-h-0 flex-col transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
            >
                {shownTarget === undefined ? null : place.kind === "review" ? (
                    <ReviewView
                        state={state}
                        starting={starting}
                        issue={issue}
                        onCancel={async () => {
                            if (
                                (await stopReview()) &&
                                !leaving.current &&
                                address.current === sub
                            ) {
                                navigate(shownTarget);
                            }
                        }}
                        onClose={close}
                    />
                ) : detail === undefined ? null : (
                    <CommitDetail
                        key={shownTarget}
                        session={id}
                        target={shownTarget}
                        shown={detail}
                        now={now}
                        upstream={data?.upstream}
                        reviewState={state}
                        open={open}
                        reread={refresh}
                        active={place.kind === "commit"}
                        view={view}
                        onReview={begin}
                        onReviewAgain={(target) => {
                            navigate(`${target}/review`);
                        }}
                        onRewritten={() => {
                            // The rewrite moves this commit: its flags and its id are read again.
                            reload();

                            // The reword outlives the form: leaving the commit meanwhile must not move the page.
                            if (!leaving.current && address.current === sub) {
                                navigate(undefined);
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
}
