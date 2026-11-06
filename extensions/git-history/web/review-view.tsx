import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/ui/pane.tsx";

import type { ReviewState } from "../refs.ts";
import { pageButton } from "./page-button.ts";
import { reviewRunning } from "./review-running.ts";

// Plannotator is a trusted installed program, not an untrusted document. It needs its
// own origin for API writes/storage. The sandbox still blocks top-level navigation.
/* oxlint-disable react/iframe-missing-sandbox -- trusted CLI UI requires scripts and same-origin storage */
function ReviewFrame({ url }: { url: string }) {
    return (
        <iframe
            title="Plannotator code review"
            src={url}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
            className="animate-drop-in min-h-0 w-full flex-1 border-0"
        />
    );
}
/* oxlint-enable react/iframe-missing-sandbox */

export function ReviewView({
    state,
    starting,
    issue,
    onCancel,
    onClose,
}: {
    state: ReviewState | null;
    starting: boolean;
    issue: string | null;
    onCancel: () => Promise<void>;
    onClose: (focus?: "composer") => void;
}) {
    const panel = useRef<HTMLDivElement>(null);
    // The CLI's frame has no accessible name of ours to land on; the layer itself takes the keyboard.
    useEffect(() => {
        panel.current?.focus();
    }, []);
    return (
        <section
            ref={panel}
            tabIndex={-1}
            aria-label="Plannotator review"
            className="flex min-h-0 flex-1 flex-col outline-none"
        >
            <Toolbar>
                <span className="text-meta text-muted">Plannotator review</span>
                {reviewRunning(state) ? (
                    <Button
                        variant="ghost"
                        className={`${pageButton} ml-auto`}
                        onClick={() => {
                            void onCancel();
                        }}
                    >
                        Cancel review
                    </Button>
                ) : null}
            </Toolbar>

            {issue !== null ? (
                <Alert className="text-interface border-edge-soft border-b">{issue}</Alert>
            ) : null}

            {starting || state?.state === "starting" ? (
                <div className="text-muted flex flex-1 items-center justify-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    Starting Plannotator…
                </div>
            ) : state?.state === "running" && state.url !== undefined ? (
                <ReviewFrame key={state.id} url={state.url} />
            ) : state?.state === "done" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
                    <h3 className="text-ink font-medium">
                        {state.decision === "dismissed"
                            ? "Review closed"
                            : state.decision === "approved"
                              ? "Approved"
                              : "Feedback received"}
                    </h3>
                    <p className="text-muted text-interface">
                        {state.decision === "dismissed"
                            ? "No feedback was sent."
                            : state.message?.trim()
                              ? "Feedback has been added to this session’s composer. Check it before sending it to the agent."
                              : "Review completed without comments."}
                    </p>
                    {state.message ? (
                        <pre className="text-meta text-muted bg-panel overflow-auto p-3 whitespace-pre-wrap">
                            {state.message}
                        </pre>
                    ) : null}
                    <Button
                        variant="ghost"
                        className={`${pageButton} self-start`}
                        onClick={() => {
                            onClose();
                        }}
                    >
                        Return to conversation
                    </Button>
                </div>
            ) : state?.state === "failed" ? (
                <Alert className="text-interface p-4">{state.error ?? "Review failed."}</Alert>
            ) : state?.state === "cancelled" ? (
                <p className="text-muted text-interface p-4">Review was cancelled.</p>
            ) : (
                <p className="text-muted text-interface p-4">Review is not running.</p>
            )}
        </section>
    );
}
