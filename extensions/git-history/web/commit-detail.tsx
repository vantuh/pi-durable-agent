import type { CodeViewHandle } from "@pierre/diffs/react";
import { Pencil } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { ago } from "@/lib/time.ts";

import type { ReviewState } from "../refs.ts";
import { ChangesView } from "./changes-view.tsx";
import { EXACT_TIME } from "./exact-time.ts";
import { pageButton } from "./page-button.ts";
import { PendingPane } from "./pending-pane.tsx";
import { actionTarget, subTarget } from "./place.ts";
import { reviewRunning } from "./review-running.ts";
import { RewordForm } from "./reword-form.tsx";
import type { Shown } from "./shown.ts";

/** What a detail with no commit message calls itself: what the target is, or why it is not here. */
const UNREAD: Record<Exclude<Shown["kind"], "commit">, string> = {
    working: "Uncommitted changes",
    reading: "Reading the commit…",
    missing: "No such commit",
    error: "Could not read the commit",
};

/** The open commit (or the working tree): its message, the actions, and its diffs in the page's scroll. */
export function CommitDetail({
    session,
    target,
    shown,
    now,
    upstream,
    reviewState,
    open,
    reread,
    active,
    view,
    onReview,
    onReviewAgain,
    onRewritten,
}: {
    session: number;
    target: string;
    shown: Shown;
    now: number;
    upstream: string | null | undefined;
    reviewState: ReviewState | null;
    open: boolean;
    reread: number;
    /** This detail is the layer on screen; a review on top of it makes it inactive for the keyboard. */
    active: boolean;
    /** The diff's own scroller: the page scrolls it with the arrows, a couple of lines a press. */
    view: RefObject<CodeViewHandle<undefined, undefined> | null>;
    onReview: (target: string) => Promise<void>;
    onReviewAgain: (target: string) => void;
    onRewritten: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [starting, setStarting] = useState(false);
    const title = useRef<HTMLHeadingElement>(null);
    // The header appears only once the diff is read (or cached), after the effect below has run.
    const takeTitle = useCallback(
        (element: HTMLHeadingElement | null) => {
            title.current = element;
            if (element !== null && active) {
                element.focus();
            }
        },
        [active],
    );
    // Entering the detail, or coming back from its review, lands the keyboard on what it is.
    useEffect(() => {
        if (active) {
            title.current?.focus();
        }
    }, [active]);
    const rewritable =
        shown.kind === "commit" &&
        !shown.commit.remote &&
        (upstream === null || shown.commit.unpushed);
    const mine = reviewState !== null && subTarget(reviewState.target) === target;
    // No actions on a target with no commit behind it, nor on a read that failed before it got there.
    const broken = shown.kind === "missing" || shown.kind === "error";
    async function begin(): Promise<void> {
        setStarting(true);
        try {
            await onReview(target);
        } finally {
            setStarting(false);
        }
    }
    const header = (
        <>
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                {shown.kind === "commit" ? (
                    <header className="flex min-w-0 grow basis-full flex-col gap-1.5 sm:basis-0">
                        <h3
                            ref={takeTitle}
                            tabIndex={-1}
                            className="text-interface text-ink leading-snug font-medium outline-none"
                        >
                            {shown.commit.subject || "(no message)"}
                        </h3>
                        {shown.commit.body === "" ? null : (
                            <p className="text-muted text-interface whitespace-pre-wrap">
                                {shown.commit.body}
                            </p>
                        )}
                        <p className="text-meta text-faint flex flex-wrap gap-2 font-mono">
                            <span>{shown.commit.short}</span>
                            <span>{shown.commit.author}</span>
                            <span title={EXACT_TIME.format(shown.commit.at)}>
                                {ago(shown.commit.at, now)}
                            </span>
                        </p>
                    </header>
                ) : (
                    <header className="flex min-w-0 grow basis-full flex-col gap-1 sm:basis-0">
                        <h3
                            ref={takeTitle}
                            tabIndex={-1}
                            className="text-interface text-ink font-medium outline-none"
                        >
                            {UNREAD[shown.kind]}
                        </h3>
                        <p className="text-meta text-faint font-mono">
                            {shown.kind === "working" ? "the working tree" : target}
                        </p>
                    </header>
                )}

                {broken ? null : (
                    <div className="flex shrink-0 flex-wrap gap-2">
                        {rewritable ? (
                            <Button
                                variant="ghost"
                                className={pageButton}
                                onClick={() => {
                                    setEditing((old) => !old);
                                }}
                            >
                                <Pencil className="size-3.5" /> Reword
                            </Button>
                        ) : null}
                        {mine && reviewRunning(reviewState) ? (
                            <Button
                                variant="ghost"
                                className={pageButton}
                                onClick={() => {
                                    onReviewAgain(target);
                                }}
                            >
                                Resume review
                            </Button>
                        ) : (
                            <Button
                                variant="ghost"
                                className={pageButton}
                                disabled={starting || reviewRunning(reviewState)}
                                onClick={() => {
                                    void begin();
                                }}
                            >
                                Review
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {editing && shown.kind === "commit" ? (
                <RewordForm
                    session={session}
                    commit={shown.commit}
                    onClose={() => {
                        setEditing(false);
                    }}
                    onRewritten={onRewritten}
                />
            ) : null}
        </>
    );

    if (shown.kind === "missing" || shown.kind === "error") {
        const failure = shown.kind === "error" ? shown.error : null;

        return (
            <PendingPane header={header}>
                {failure === null ? (
                    <Empty className="text-muted text-interface p-3">
                        Nothing in this folder's history has that id. Open the history to pick a
                        commit.
                    </Empty>
                ) : (
                    <Alert className="text-interface p-3">
                        {failure} Refresh the history to try again.
                    </Alert>
                )}
            </PendingPane>
        );
    }

    return (
        <ChangesView
            session={session}
            target={actionTarget(target)}
            header={header}
            viewRef={view}
            open={open}
            reread={reread}
        />
    );
}
