import { useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { PageProps } from "@/sdk/types.ts";

import { messageOf } from "../../../shared/guards.ts";
import { cancel, review, start, type ReviewState } from "../refs.ts";
import { actionTarget } from "./place.ts";
import { reviewRunning } from "./review-running.ts";

/** Reviews whose feedback the composer has taken: reopening the page must not append or close again. */
const reported = new Set<string>();

/**
 * The Plannotator review of this session: polled while the page is open, ended when the page goes, and its
 * feedback handed to the composer. `leaving` is true from the page's unmount on, for a call still in flight.
 */
export function useReview({
    id,
    navigate,
    close,
    setIssue,
}: {
    id: number;
    navigate: PageProps["navigate"];
    close: PageProps["close"];
    setIssue: (issue: string | null) => void;
}) {
    const [state, setState] = useState<ReviewState | null>(null);
    const [starting, setStarting] = useState(false);
    const latestReview = useRef<ReviewState | null>(null);
    const leaving = useRef(false);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const found = await callAction(review, undefined, id);
                if (alive) {
                    setState(found);
                } else if (found !== null && reviewRunning(found)) {
                    // The answer arrived after the page left: nobody would see this review, so stop it.
                    void callAction(cancel, { id: found.id }, id).catch(() => undefined);
                }
            } catch (error) {
                if (alive) {
                    setIssue(messageOf(error));
                }
            }
            if (alive) {
                timer = setTimeout(() => {
                    void poll();
                }, 1500);
            }
        };
        void poll();
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [id, setIssue]);

    // Leaving the page ends a review still running, as closing the old dialog did.
    useEffect(() => {
        latestReview.current = state;
    }, [state]);
    useEffect(() => {
        leaving.current = false;
        return () => {
            leaving.current = true;
            const found = latestReview.current;
            if (found !== null && reviewRunning(found)) {
                void callAction(cancel, { id: found.id }, id).catch(() => undefined);
            }
        };
    }, [id]);

    // Feedback goes into the composer and the person lands in the chat to edit and send it themselves.
    useEffect(() => {
        if (state?.state !== "done" || state.decision === "dismissed" || !state.message?.trim()) {
            return;
        }
        const key = `${String(id)}:${state.id}`;

        if (reported.has(key)) {
            return;
        }

        reported.add(key);
        appendComposerDraft(id, state.message, `git-history:${state.id}`);
        close("composer");
    }, [id, state, close]);

    async function begin(target: string): Promise<void> {
        setStarting(true);
        setIssue(null);
        // The review's own place, at once: starting the CLI can take a while and its spinner belongs there.
        navigate(`${target}/review`);
        try {
            const found = await callAction(start, { target: actionTarget(target) }, id);
            if (found !== null) {
                if (leaving.current) {
                    // The page is gone, so nobody would see this review: stop it instead of leaving it to expire.
                    void callAction(cancel, { id: found.id }, id).catch(() => undefined);
                } else {
                    setState(found);
                }
            }
        } catch (error) {
            setIssue(messageOf(error));
        } finally {
            setStarting(false);
        }
    }

    async function stopReview(): Promise<boolean> {
        if (state === null) {
            return false;
        }
        try {
            setState(await callAction(cancel, { id: state.id }, id));
            return true;
        } catch (error) {
            setIssue(messageOf(error));
            return false;
        }
    }

    return { state, starting, begin, stopReview, leaving };
}
