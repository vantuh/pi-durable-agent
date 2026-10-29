import {
    History as HistoryIcon,
    ArrowLeft,
    ArrowDown,
    ArrowUp,
    Pencil,
    RefreshCw,
    LoaderCircle,
} from "lucide-react";
import {
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog.tsx";
import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { PatchPreview } from "./preview.tsx";
import {
    cancel,
    changes,
    history,
    reword,
    review,
    start,
    type Changes,
    type Commit,
    type History,
    type ReviewState,
} from "./refs.ts";

const button =
    "rounded-control border-edge hover:bg-raised text-interface border px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const running = (value: ReviewState | null) =>
    value?.state === "starting" || value?.state === "running";

const fieldClass =
    "rounded-control border-edge bg-sunken text-ink text-interface focus-visible:ring-accent w-full border px-2 py-1.5 outline-none focus-visible:ring-2";

function submitOnEnter(event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
    }
}

function RewordForm({
    session,
    commit,
    onRewritten,
    onClose,
}: {
    session: number;
    commit: Commit;
    onRewritten: () => void;
    onClose: () => void;
}) {
    const [subject, setSubject] = useState(commit.subject);
    const [body, setBody] = useState(commit.body);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        // Window capture runs before the dialog's own Escape handler, which would close the whole history.
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
        };
    }, [onClose]);
    async function save(event: FormEvent) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            await callAction(reword, { hash: commit.hash, subject, body }, session);
            onRewritten();
        } catch (failure) {
            setError(errorText(failure));
            setSaving(false);
        }
    }
    return (
        <form
            onSubmit={(event) => {
                void save(event);
            }}
            className="border-edge-soft bg-panel space-y-2 border-t px-3 py-3"
        >
            <p className="text-meta text-muted">
                <span className="font-mono">{commit.short}</span> and the commits after it get new
                ids. The files stay as they are.
            </p>
            <label className="block">
                <span className="text-meta text-muted">Title</span>
                <input
                    value={subject}
                    onChange={(event) => {
                        setSubject(event.target.value);
                    }}
                    onKeyDown={submitOnEnter}
                    className={fieldClass}
                />
            </label>
            <label className="block">
                <span className="text-meta text-muted">Description</span>
                <textarea
                    rows={6}
                    value={body}
                    onChange={(event) => {
                        setBody(event.target.value);
                    }}
                    onKeyDown={submitOnEnter}
                    className={fieldClass}
                />
            </label>
            {error !== null ? (
                <p role="alert" className="text-danger text-meta">
                    {error}
                </p>
            ) : null}
            <div className="flex gap-2">
                <button type="button" className={button} disabled={saving} onClick={onClose}>
                    Cancel
                </button>
                <button
                    type="submit"
                    className="rounded-control bg-accent text-on-accent text-interface px-4 py-1.5 font-medium disabled:opacity-40"
                    disabled={saving || subject.trim() === ""}
                >
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
        </form>
    );
}

function Preview({ session, target }: { session: number; target: string }) {
    const [data, setData] = useState<Changes | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const found = await callAction(changes, { target }, session);
                if (alive) {
                    setData(found);
                }
            } catch (failure) {
                if (alive) {
                    setError(errorText(failure));
                }
            }
        })();
        return () => {
            alive = false;
        };
    }, [session, target]);
    if (error !== null) {
        return (
            <p role="alert" className="text-danger p-3">
                {error}
            </p>
        );
    }
    if (data === null) {
        return <p className="text-muted p-3">Reading changes…</p>;
    }
    return (
        <div className="border-edge-soft bg-panel border-t">
            <div className="text-meta text-muted flex flex-wrap gap-3 px-3 py-2">
                <span>{data.files.length} files</span>
                <span className="text-ok">
                    +{data.files.reduce((sum, file) => sum + file.added, 0)}
                </span>
                <span className="text-danger">
                    −{data.files.reduce((sum, file) => sum + file.deleted, 0)}
                </span>
            </div>
            {data.truncated ? (
                <p className="text-warn text-meta px-3 pb-2">
                    Preview is limited to 400 KiB; oversized changes or new symlinks are listed
                    without their diff.
                </p>
            ) : null}
            {data.files.length === 0 ? (
                <p className="text-meta text-muted p-3">No changes.</p>
            ) : null}
            <PatchPreview data={data} />
        </div>
    );
}

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
            className="min-h-0 w-full flex-1 border-0"
        />
    );
}
/* oxlint-enable react/iframe-missing-sandbox */

function HistoryDialog({ session }: { session: NonNullable<StatusProps["session"]> }) {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<History | null>(null);
    const [limit, setLimit] = useState(50);
    const [refresh, setRefresh] = useState(0);
    const [selected, setSelected] = useState<string | null>(null);
    const [state, setState] = useState<ReviewState | null>(null);
    const [issue, setIssue] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [starting, setStarting] = useState(false);
    const [closing, setClosing] = useState(false);
    const [editing, setEditing] = useState<Commit | null>(null);
    const pendingStart = useRef<Promise<ReviewState | null> | null>(null);
    const [viewer, setViewer] = useState(false);
    const id = session.id;

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let alive = true;
        void (async () => {
            try {
                const found = await callAction(history, { limit }, id);
                if (alive) {
                    setData(found);
                    setIssue(null);
                }
            } catch (error) {
                if (alive) {
                    setIssue(errorText(error));
                }
            } finally {
                if (alive) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Refresh explicitly reloads the same Git query
    }, [id, open, limit, refresh]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const found = await callAction(review, undefined, id);
                if (alive) {
                    setState(found);
                }
            } catch (error) {
                if (alive) {
                    setIssue(errorText(error));
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
    }, [id, open]);

    useEffect(() => {
        if (state?.state === "done" && state.decision !== "dismissed" && state.message?.trim()) {
            appendComposerDraft(id, state.message, `git-history:${state.id}`);
        }
    }, [id, state]);

    async function begin(target: string) {
        setStarting(true);
        setIssue(null);
        const request = callAction(start, { target }, id);
        pendingStart.current = request;
        try {
            const found = await request;
            setState(found);
            setViewer(true);
        } catch (error) {
            setIssue(errorText(error));
        } finally {
            pendingStart.current = null;
            setStarting(false);
        }
    }
    async function closeDialog() {
        if (closing) {
            return;
        }
        setClosing(true);
        try {
            // A close must not overtake an in-flight start; begin reports its own errors.
            await pendingStart.current?.catch(() => undefined);
            const current = await callAction(review, undefined, id);
            setState(
                current !== null && running(current)
                    ? await callAction(cancel, { id: current.id }, id)
                    : current,
            );
            setViewer(false);
            setOpen(false);
        } catch (error) {
            setIssue(errorText(error));
        } finally {
            setClosing(false);
        }
    }
    async function stopReview() {
        if (state === null) {
            return;
        }
        try {
            setState(await callAction(cancel, { id: state.id }, id));
            setViewer(false);
        } catch (error) {
            setIssue(errorText(error));
        }
    }
    const canStart = !starting && !closing && !running(state);
    // A commit the upstream can reach keeps its message: a push could not send the new history.
    const rewritable = (commit: Commit) =>
        !commit.remote && (data?.upstream === null || commit.unpushed);
    const row = (
        target: string,
        title: string,
        detail: string,
        marker?: "local" | "remote",
        commit?: Commit,
    ) => (
        <li key={target} className="border-edge-soft border-b">
            <div className="flex items-center gap-2 px-3 py-3">
                <button
                    type="button"
                    aria-expanded={selected === target}
                    onClick={() => {
                        setSelected((old) => (old === target ? null : target));
                    }}
                    className="min-w-0 flex-1 text-left"
                >
                    <span className="text-interface text-ink flex items-center gap-1.5 font-medium">
                        {marker === "local" ? (
                            <ArrowUp className="text-ok size-3 shrink-0" aria-label="Not pushed" />
                        ) : marker === "remote" ? (
                            <ArrowDown
                                className="text-info size-3 shrink-0"
                                aria-label="Not pulled"
                            />
                        ) : null}
                        <span className="truncate">{title}</span>
                    </span>
                    <span className="text-meta text-faint block truncate">{detail}</span>
                </button>
                {commit !== undefined && rewritable(commit) ? (
                    <button
                        type="button"
                        title="Edit the commit message"
                        aria-label="Edit the commit message"
                        className={button}
                        onClick={() => {
                            setEditing((old) => (old?.hash === commit.hash ? null : commit));
                        }}
                    >
                        <Pencil className="size-3.5" />
                    </button>
                ) : null}
                <button
                    type="button"
                    className={button}
                    disabled={!canStart}
                    onClick={() => {
                        void begin(target);
                    }}
                >
                    Review
                </button>
            </div>
            {selected === target ? (
                <Preview key={`${target}:${String(refresh)}`} session={id} target={target} />
            ) : null}
            {editing?.hash === target ? (
                <RewordForm
                    session={id}
                    commit={editing}
                    onClose={() => {
                        setEditing(null);
                    }}
                    onRewritten={() => {
                        setEditing(null);
                        setSelected(null);
                        setLoading(true);
                        setRefresh((value) => value + 1);
                    }}
                />
            ) : null}
        </li>
    );

    return (
        <>
            <button
                type="button"
                title="Git history & review"
                aria-label="Git history & review"
                onClick={() => {
                    setLoading(true);
                    setOpen(true);
                }}
                className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
            >
                <HistoryIcon className="size-4" />
            </button>
            <Dialog
                open={open}
                onOpenChange={(value) => {
                    if (value) {
                        setOpen(true);
                    } else {
                        void closeDialog();
                    }
                }}
            >
                <DialogContent className="sm:inset-3 sm:max-h-none sm:w-auto sm:max-w-none sm:translate-x-0 sm:translate-y-0">
                    <DialogHeader>
                        <div className="flex min-w-0 items-center gap-2">
                            <DialogTitle className="min-w-0 flex-1 truncate">
                                {viewer ? "Plannotator review" : "Git history & review"}
                            </DialogTitle>
                            {viewer ? (
                                <button
                                    type="button"
                                    title="Back to history"
                                    className="rounded-control text-meta text-muted hover:bg-raised hover:text-ink focus-visible:ring-accent flex shrink-0 items-center gap-1 px-2 py-0.5 outline-none focus-visible:ring-2"
                                    onClick={() => {
                                        setViewer(false);
                                    }}
                                >
                                    <ArrowLeft className="size-3" /> History
                                </button>
                            ) : null}
                        </div>
                        <DialogDescription>
                            {viewer
                                ? "Review stays inside this app. Feedback returns to the composer; nothing is sent automatically."
                                : "Commits and uncommitted changes in this session’s folder. Ahead/behind reflects the last fetch."}
                        </DialogDescription>
                    </DialogHeader>
                    {!viewer ? (
                        <div className="border-edge-soft text-meta text-muted flex flex-wrap items-center gap-2 border-b px-3 py-2">
                            <span
                                className="min-w-0 flex-1 truncate font-mono"
                                title={session.cwd ?? ""}
                            >
                                {data?.branch ?? session.cwd}
                            </span>
                            {data?.upstream ? (
                                <span title={data.upstream}>
                                    ↑{data.ahead} ↓{data.behind}
                                </span>
                            ) : null}
                            <button
                                type="button"
                                title="Refresh history"
                                disabled={loading}
                                className={button}
                                onClick={() => {
                                    setLoading(true);
                                    setRefresh((value) => value + 1);
                                }}
                            >
                                <RefreshCw
                                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                                />
                            </button>
                            {running(state) ? (
                                <>
                                    <button
                                        type="button"
                                        className={button}
                                        onClick={() => {
                                            setViewer(true);
                                        }}
                                    >
                                        Resume review
                                    </button>
                                    <button
                                        type="button"
                                        className={button}
                                        disabled={closing}
                                        onClick={() => {
                                            void stopReview();
                                        }}
                                    >
                                        Cancel review
                                    </button>
                                </>
                            ) : null}
                        </div>
                    ) : null}
                    {issue !== null ? (
                        <p
                            role="alert"
                            className="text-danger text-interface border-edge-soft border-b px-3 py-2"
                        >
                            {issue}
                        </p>
                    ) : null}
                    {state?.state === "failed" ? (
                        <p role="alert" className="text-danger text-interface px-3 py-2">
                            {state.error}
                        </p>
                    ) : null}
                    {viewer && state?.state === "running" && state.url ? (
                        <ReviewFrame key={state.id} url={state.url} />
                    ) : viewer && (starting || state?.state === "starting") ? (
                        <div className="text-muted flex flex-1 items-center justify-center gap-2">
                            <LoaderCircle className="size-4 animate-spin" />
                            Starting Plannotator…
                        </div>
                    ) : viewer && state?.state === "done" ? (
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
                                <pre className="text-meta text-muted bg-panel rounded-card overflow-auto p-3 whitespace-pre-wrap">
                                    {state.message}
                                </pre>
                            ) : null}
                            <button
                                type="button"
                                className={`${button} self-start`}
                                onClick={() => {
                                    setOpen(false);
                                }}
                            >
                                Return to conversation
                            </button>
                        </div>
                    ) : viewer ? (
                        <div className="text-muted text-interface p-4">
                            Review is not running. Return to history to start another.
                        </div>
                    ) : (
                        <div className="min-h-0 flex-1 overflow-auto">
                            {data === null && loading ? (
                                <p className="text-muted p-4">Reading Git history…</p>
                            ) : null}
                            {data !== null ? (
                                <>
                                    <ol>
                                        {data.changes > 0
                                            ? row(
                                                  "worktree",
                                                  "Uncommitted changes",
                                                  `${String(data.changes)} files changed · live Git review`,
                                              )
                                            : null}
                                        {data.commits.map((commit) =>
                                            row(
                                                commit.hash,
                                                commit.subject || "(no message)",
                                                `${commit.short} · ${commit.author} · ${new Date(commit.at).toLocaleString()}`,
                                                commit.remote
                                                    ? "remote"
                                                    : commit.unpushed
                                                      ? "local"
                                                      : undefined,
                                                commit,
                                            ),
                                        )}
                                    </ol>
                                    {data.commits.length === 0 && data.changes === 0 ? (
                                        <p className="text-muted p-4">
                                            No commits or uncommitted changes yet.
                                        </p>
                                    ) : null}
                                    {data.more ? (
                                        <div className="p-3">
                                            <button
                                                type="button"
                                                className={button}
                                                disabled={limit >= 200 || loading}
                                                onClick={() => {
                                                    setLoading(true);
                                                    setLimit((value) => Math.min(200, value + 50));
                                                }}
                                            >
                                                {limit >= 200
                                                    ? "Showing the newest 200 commits"
                                                    : "Load older commits"}
                                            </button>
                                        </div>
                                    ) : null}
                                </>
                            ) : null}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
function Item({ session }: StatusProps) {
    return session === null ? null : <HistoryDialog key={session.id} session={session} />;
}
export default { header: [{ id: "history", component: Item }] } satisfies WebExtension;
