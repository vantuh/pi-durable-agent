import type { CodeViewHandle } from "@pierre/diffs/react";
import {
    History as HistoryIcon,
    ArrowDown,
    ArrowUp,
    ChevronRight,
    Pencil,
    RefreshCw,
    LoaderCircle,
    GitBranch,
} from "lucide-react";
import {
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    lazy,
    type ReactNode,
    type RefObject,
    Suspense,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { Badge } from "@/components/ui/badge.tsx";
import { ago, MINUTE } from "@/lib/time.ts";
import { callAction } from "@/sdk/actions.ts";
import { appendComposerDraft } from "@/sdk/composer.ts";
import type { PageProps, WebExtension } from "@/sdk/types.ts";

import {
    UNTRACKED_FILE_CAP,
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

/**
 * Pierre's diff view and its shiki warm-up are 630 kB of client code that only the open page draws, so the
 * module is fetched when a commit opens: at boot it would be downloaded for a page that may never open.
 */
const loadPreview = () => import("./preview.tsx");
const PatchPreview = lazy(async () => ({ default: (await loadPreview()).PatchPreview }));

/** Uncommitted changes travel as `worktree` to the server and as `working` in the address: a commit
 * hash is hex, so it can never be mistaken for the working tree. */
const WORKING = "working";

/** Reviews whose feedback the composer has taken: reopening the page must not append or close again. */
const reported = new Set<string>();
const HASH = /^[0-9a-f]{4,64}$/i;

const button =
    "rounded-control border-edge hover:bg-raised text-interface border px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
// A commit row counts from now; this is the same instant spelled out in the reader's own zone.
const EXACT_TIME = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
});
const running = (value: ReviewState | null) =>
    value?.state === "starting" || value?.state === "running";

const fieldClass =
    "rounded-control border-edge bg-sunken text-ink text-interface focus-visible:ring-accent w-full border px-2 py-1.5 outline-none focus-visible:ring-2";

/** A place in the page: the list, one commit (or the working tree), or a review of it. */
type Place =
    | { kind: "list" }
    | { kind: "commit"; target: string }
    | { kind: "review"; target: string };

/** The address's `sub` as a place; anything else falls back to the list. */
function placeOf(sub: string | undefined): Place {
    if (sub === undefined) {
        return { kind: "list" };
    }

    const [first, ...rest] = sub.split("/");
    const target = first === undefined ? undefined : targetOfSub(first);

    if (target === undefined) {
        return { kind: "list" };
    }

    if (rest.length === 0) {
        return { kind: "commit", target };
    }

    return rest.length === 1 && rest[0] === "review"
        ? { kind: "review", target }
        : { kind: "list" };
}

function targetOfSub(sub: string): string | undefined {
    return sub === WORKING || HASH.test(sub) ? sub : undefined;
}

/** The action's name for a place's target. */
const actionTarget = (target: string): string => (target === WORKING ? "worktree" : target);

/** The address's name for a review's target. */
const subTarget = (target: string): string => (target === "worktree" ? WORKING : target);

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
    const titleRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        titleRef.current?.focus();
    }, []);
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
                    ref={titleRef}
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

/** A commit's diff never changes, so reopening it is free; only the working tree is read each time. */
const patches = new Map<string, Changes>();
const pendingPatches = new Map<string, Promise<Changes>>();
const PATCHES_KEPT = 20;

const patchKey = (session: number, target: string): string => `${String(session)}:${target}`;

function cachedPatch(session: number, target: string): Changes | undefined {
    return patches.get(patchKey(session, target));
}

/** A second click waits for the request already in flight rather than starting its own. */
function loadChanges(session: number, target: string): Promise<Changes> {
    if (target === "worktree") {
        return callAction(changes, { target }, session);
    }
    const found = cachedPatch(session, target);
    if (found !== undefined) {
        return Promise.resolve(found);
    }
    const key = patchKey(session, target);
    const pending = pendingPatches.get(key);
    if (pending !== undefined) {
        return pending;
    }
    const request = callAction(changes, { target }, session)
        .then((result) => {
            patches.set(key, result);
            const oldest = patches.keys().next().value;
            if (patches.size > PATCHES_KEPT && oldest !== undefined) {
                patches.delete(oldest);
            }
            return result;
        })
        .finally(() => {
            pendingPatches.delete(key);
        });
    pendingPatches.set(key, request);
    return request;
}

function forgetPatches(): void {
    patches.clear();
}

const PREFETCHED = 3;
const HOVER_DELAY = 120;

/** Reading is half the wait; parsing and highlighting otherwise start on the click. */
async function prefetch(session: number, target: string): Promise<void> {
    const found = await loadChanges(session, target);
    const { warmPreview } = await loadPreview();
    await warmPreview(found.patch);
}

/** Sweeping the mouse down the list must not read every commit it crosses. */
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
function prefetchSoon(session: number, target: string | undefined): void {
    clearTimeout(hoverTimer);
    if (target === undefined) {
        return;
    }
    hoverTimer = setTimeout(() => {
        void prefetch(session, target).catch(() => undefined);
    }, HOVER_DELAY);
}

function whenIdle(run: () => void): () => void {
    if (typeof requestIdleCallback !== "function") {
        const timer = setTimeout(run, 200);
        return () => {
            clearTimeout(timer);
        };
    }
    const handle = requestIdleCallback(run, { timeout: 1500 });
    return () => {
        cancelIdleCallback(handle);
    };
}

/** The page's one scroll until the diff is ready: the commit's own header, then a note. */
function PendingPane({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 px-3 py-3">{header}</div>
            {children}
        </div>
    );
}

/** One commit's changes; the diff, when it is drawn, owns the page's only scroll. */
function ChangesView({
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
                    setError(errorText(failure));
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
                <p role="alert" className="text-danger p-3">
                    {error}
                </p>
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

/** A row of the list: the whole row opens the commit. */
function HistoryRow({
    target,
    title,
    detail,
    at,
    marker,
    onOpen,
    onPrefetch,
    rowRef,
}: {
    target: string;
    title: string;
    detail: string;
    at: number | undefined;
    marker: "local" | "remote" | undefined;
    onOpen: (target: string) => void;
    onPrefetch: (target: string | undefined) => void;
    rowRef: (element: HTMLButtonElement | null) => void;
}) {
    return (
        <li className="border-edge-soft border-b">
            <button
                ref={rowRef}
                type="button"
                onClick={() => {
                    onOpen(target);
                }}
                onPointerEnter={() => {
                    onPrefetch(target === WORKING ? undefined : target);
                }}
                onPointerLeave={() => {
                    onPrefetch(undefined);
                }}
                onFocus={() => {
                    onPrefetch(target === WORKING ? undefined : target);
                }}
                className="hover:bg-raised focus-visible:ring-accent flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-interface text-ink flex items-center gap-1.5 leading-tight font-medium">
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
                    <span
                        className="text-meta text-faint block truncate font-mono leading-tight"
                        title={at === undefined ? undefined : EXACT_TIME.format(at)}
                    >
                        {detail}
                    </span>
                </span>
                <ChevronRight className="text-faint size-4 shrink-0" />
            </button>
        </li>
    );
}

/** The open commit (or the working tree): its message, the actions, and its diffs in the page's scroll. */
function CommitDetail({
    session,
    target,
    commit,
    now,
    upstream,
    reviewState,
    open,
    reread,
    active,
    onReview,
    onReviewAgain,
    onRewritten,
}: {
    session: number;
    target: string;
    commit: Commit | undefined;
    now: number;
    upstream: string | null | undefined;
    reviewState: ReviewState | null;
    open: boolean;
    reread: number;
    /** This detail is the layer on screen; a review on top of it makes it inactive for the keyboard. */
    active: boolean;
    onReview: (target: string) => Promise<void>;
    onReviewAgain: (target: string) => void;
    onRewritten: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [starting, setStarting] = useState(false);
    const view = useRef<CodeViewHandle<undefined, undefined>>(null);
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
    // A page opens at its top, even when the commit was read before.
    useEffect(() => {
        if (open) {
            view.current?.scrollTo({ type: "position", position: 0, behavior: "instant" });
        }
    }, [open]);
    // Entering the detail, or coming back from its review, lands the keyboard on what it is.
    useEffect(() => {
        if (active) {
            title.current?.focus();
        }
    }, [active]);
    const rewritable =
        commit !== undefined && !commit.remote && (upstream === null || commit.unpushed);
    const mine = reviewState !== null && subTarget(reviewState.target) === target;
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
                {commit === undefined ? (
                    <header className="flex min-w-0 grow basis-full flex-col gap-1 sm:basis-0">
                        <h3
                            ref={takeTitle}
                            tabIndex={-1}
                            className="text-interface text-ink font-medium outline-none"
                        >
                            Uncommitted changes
                        </h3>
                        <p className="text-meta text-faint font-mono">the working tree</p>
                    </header>
                ) : (
                    <header className="flex min-w-0 grow basis-full flex-col gap-1.5 sm:basis-0">
                        <h3
                            ref={takeTitle}
                            tabIndex={-1}
                            className="text-interface text-ink text-prose leading-snug font-medium outline-none"
                        >
                            {commit.subject || "(no message)"}
                        </h3>
                        {commit.body === "" ? null : (
                            <p className="text-muted text-interface whitespace-pre-wrap">
                                {commit.body}
                            </p>
                        )}
                        <p className="text-meta text-faint flex flex-wrap gap-2 font-mono">
                            <span>{commit.short}</span>
                            <span>{commit.author}</span>
                            <span title={EXACT_TIME.format(commit.at)}>{ago(commit.at, now)}</span>
                        </p>
                    </header>
                )}

                <div className="flex shrink-0 flex-wrap gap-2">
                    {rewritable && commit !== undefined ? (
                        <button
                            type="button"
                            className={`${button} flex items-center gap-1.5`}
                            onClick={() => {
                                setEditing((old) => !old);
                            }}
                        >
                            <Pencil className="size-3.5" /> Reword
                        </button>
                    ) : null}
                    {mine && running(reviewState) ? (
                        <button
                            type="button"
                            className={button}
                            onClick={() => {
                                onReviewAgain(target);
                            }}
                        >
                            Resume review
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={button}
                            disabled={starting || running(reviewState)}
                            onClick={() => {
                                void begin();
                            }}
                        >
                            Review
                        </button>
                    )}
                </div>
            </div>

            {editing && commit !== undefined ? (
                <RewordForm
                    session={session}
                    commit={commit}
                    onClose={() => {
                        setEditing(false);
                    }}
                    onRewritten={onRewritten}
                />
            ) : null}
        </>
    );

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

function ReviewView({
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
            <div className="border-edge-soft flex items-center gap-2 border-b px-3 py-1.5">
                <span className="text-meta text-muted">Plannotator review</span>
                {running(state) ? (
                    <button
                        type="button"
                        className={`${button} ml-auto`}
                        onClick={() => {
                            void onCancel();
                        }}
                    >
                        Cancel review
                    </button>
                ) : null}
            </div>

            {issue !== null ? (
                <p
                    role="alert"
                    className="text-danger text-interface border-edge-soft border-b px-3 py-2"
                >
                    {issue}
                </p>
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
                        <pre className="text-meta text-muted bg-panel rounded-card overflow-auto p-3 whitespace-pre-wrap">
                            {state.message}
                        </pre>
                    ) : null}
                    <button
                        type="button"
                        className={`${button} self-start`}
                        onClick={() => {
                            onClose();
                        }}
                    >
                        Return to conversation
                    </button>
                </div>
            ) : state?.state === "failed" ? (
                <p role="alert" className="text-danger text-interface p-4">
                    {state.error ?? "Review failed."}
                </p>
            ) : state?.state === "cancelled" ? (
                <p className="text-muted text-interface p-4">Review was cancelled.</p>
            ) : (
                <p className="text-muted text-interface p-4">Review is not running.</p>
            )}
        </section>
    );
}

/** The Git history page: the list at its root, a commit (or the working tree) at `<target>`, a review at `<target>/review`. */
function GitHistoryPage({ session, sub, navigate, close }: PageProps) {
    const id = session.id;
    const place = placeOf(sub);
    const open = place.kind !== "list";
    const [detailTarget, setDetailTarget] = useState<string | undefined>(
        place.kind === "list" ? undefined : place.target,
    );
    const openedTarget = place.kind === "list" ? undefined : place.target;
    const shownTarget = openedTarget ?? detailTarget;

    const [data, setData] = useState<History | null>(null);
    const [limit, setLimit] = useState(50);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [issue, setIssue] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [state, setState] = useState<ReviewState | null>(null);
    const [starting, setStarting] = useState(false);
    const rows = useRef(new Map<string, HTMLButtonElement>());
    const layer = useRef(false);
    const latestReview = useRef<ReviewState | null>(null);
    const leaving = useRef(false);
    const address = useRef(sub);

    // The list says how long ago each commit landed, so the clock it counts from ticks while open.
    useEffect(() => {
        const tick = setInterval(() => {
            setNow(Date.now());
        }, MINUTE);
        return () => {
            clearInterval(tick);
        };
    }, []);

    useEffect(() => {
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
    }, [id, limit, refresh]);

    // The newest commits are the ones opened next: read them while nobody is waiting.
    useEffect(() => {
        if (data === null) {
            return undefined;
        }
        let alive = true;
        let stop: () => void = () => undefined;
        const warm = async (index: number): Promise<void> => {
            const commit = data.commits[index];
            if (!alive || commit === undefined || index >= PREFETCHED) {
                return;
            }
            await prefetch(id, commit.hash).catch(() => undefined);
            if (alive) {
                stop = whenIdle(() => {
                    void warm(index + 1);
                });
            }
        };
        stop = whenIdle(() => {
            void warm(0);
        });
        return () => {
            alive = false;
            stop();
        };
    }, [id, data]);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const found = await callAction(review, undefined, id);
                if (alive) {
                    setState(found);
                } else if (found !== null && running(found)) {
                    // The answer arrived after the page left: nobody would see this review, so stop it.
                    void callAction(cancel, { id: found.id }, id).catch(() => undefined);
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
    }, [id]);

    useEffect(() => {
        address.current = sub;
    }, [sub]);

    // Leaving the page ends a review still running, as closing the old dialog did.
    useEffect(() => {
        latestReview.current = state;
    }, [state]);
    useEffect(() => {
        leaving.current = false;
        return () => {
            leaving.current = true;
            const found = latestReview.current;
            if (found !== null && running(found)) {
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
        navigate(target);
    };

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
            setIssue(errorText(error));
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
            setIssue(errorText(error));
            return false;
        }
    }

    const commit =
        shownTarget === undefined || actionTarget(shownTarget) === "worktree"
            ? undefined
            : data?.commits.find((candidate) => candidate.hash === shownTarget);
    const toolbar = (
        <div className="border-edge-soft flex min-h-[35px] flex-wrap items-center gap-2 border-b px-3 py-1.5">
            {data?.branch ? (
                <Badge
                    title={`${data.branch} in ${session.cwd ?? "this folder"}`}
                    className="h-4 max-w-36 min-w-0 shrink px-1.5 [&>svg]:size-2.5"
                >
                    <GitBranch />
                    <span className="truncate">{data.branch}</span>
                </Badge>
            ) : null}
            {data?.upstream ? (
                <span
                    className="text-meta text-muted shrink-0"
                    title={`${data.upstream} as of the last fetch`}
                >
                    ↑{data.ahead} ↓{data.behind}
                </span>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-2">
                {running(state) ? (
                    <>
                        <button
                            type="button"
                            className={button}
                            onClick={() => {
                                if (state !== null) {
                                    navigate(`${subTarget(state.target)}/review`);
                                }
                            }}
                        >
                            Resume review
                        </button>
                        <button
                            type="button"
                            className={button}
                            onClick={() => {
                                void stopReview();
                            }}
                        >
                            Cancel review
                        </button>
                    </>
                ) : null}
                <button
                    type="button"
                    title="Refresh history"
                    aria-label="Refresh history"
                    disabled={loading}
                    className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center disabled:opacity-40"
                    onClick={() => {
                        setLoading(true);
                        forgetPatches();
                        setRefresh((value) => value + 1);
                    }}
                >
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>
        </div>
    );

    return (
        <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
                inert={open}
                aria-hidden={open}
                className={`absolute inset-0 flex min-h-0 flex-col transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "-translate-x-full" : "translate-x-0"}`}
            >
                {toolbar}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {issue !== null ? (
                        <p
                            role="alert"
                            className="text-danger text-interface border-edge-soft border-b px-3 py-2"
                        >
                            {issue}
                        </p>
                    ) : null}
                    {data === null && loading ? (
                        <p className="text-muted p-4">Reading Git history…</p>
                    ) : null}
                    {data !== null ? (
                        <>
                            <ol>
                                {data.changes > 0 ? (
                                    <HistoryRow
                                        target={WORKING}
                                        title="Uncommitted changes"
                                        detail={`${String(data.changes)} files changed · live Git review`}
                                        at={undefined}
                                        marker={undefined}
                                        onOpen={openCommit}
                                        onPrefetch={(target) => {
                                            prefetchSoon(id, target);
                                        }}
                                        rowRef={(element) => {
                                            if (element === null) {
                                                rows.current.delete(WORKING);
                                            } else {
                                                rows.current.set(WORKING, element);
                                            }
                                        }}
                                    />
                                ) : null}
                                {data.commits.map((each) => (
                                    <HistoryRow
                                        key={each.hash}
                                        target={each.hash}
                                        title={each.subject || "(no message)"}
                                        detail={`${each.short} · ${each.author} · ${ago(each.at, now)}`}
                                        at={each.at}
                                        marker={
                                            each.remote
                                                ? "remote"
                                                : each.unpushed
                                                  ? "local"
                                                  : undefined
                                        }
                                        onOpen={openCommit}
                                        onPrefetch={(target) => {
                                            prefetchSoon(id, target);
                                        }}
                                        rowRef={(element) => {
                                            if (element === null) {
                                                rows.current.delete(each.hash);
                                            } else {
                                                rows.current.set(each.hash, element);
                                            }
                                        }}
                                    />
                                ))}
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
                ) : (
                    <CommitDetail
                        key={shownTarget}
                        session={id}
                        target={shownTarget}
                        commit={commit}
                        now={now}
                        upstream={data?.upstream}
                        reviewState={state}
                        open={open}
                        reread={refresh}
                        active={place.kind === "commit"}
                        onReview={begin}
                        onReviewAgain={(target) => {
                            navigate(`${target}/review`);
                        }}
                        onRewritten={() => {
                            setLoading(true);
                            forgetPatches();
                            setRefresh((value) => value + 1);

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

export default {
    pages: [
        {
            id: "history",
            title: "Git history",
            icon: <HistoryIcon className="size-4" />,
            component: GitHistoryPage,
        },
    ],
} satisfies WebExtension;
