import {
    ArrowLeft,
    ArrowRight,
    Monitor,
    RotateCw,
    Smartphone,
    Tablet,
    Terminal,
    X,
} from "lucide-react";
import {
    type ClipboardEvent,
    type KeyboardEvent,
    type PointerEvent,
    useEffect,
    useRef,
    useState,
} from "react";

import { callAction } from "@/sdk/actions.ts";
import type { PanelProps } from "@/sdk/types.ts";

import {
    type BrowserState,
    type Control,
    type Frame,
    type LogEntry,
    control,
    frame,
    input,
    logs,
    state,
} from "./refs.ts";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const PRESETS = [
    { name: "mobile", icon: Smartphone },
    { name: "tablet", icon: Tablet },
    { name: "desktop", icon: Monitor },
] as const;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** The page's state, read once a second while the panel is open; `set` takes the answer of a control. */
function usePageState(id: number | null) {
    const [page, set] = useState<BrowserState | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (id === null) {
            return undefined;
        }

        let alive = true;
        const read = async (): Promise<void> => {
            try {
                const next = await callAction(state, undefined, id);

                if (alive) {
                    set(next);
                    setError(null);
                }
            } catch (failure) {
                if (alive) {
                    setError(failure instanceof Error ? failure.message : String(failure));
                }
            }
        };

        void read();
        const timer = setInterval(() => void read(), 1000);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [id]);

    const run = async (what: Control): Promise<void> => {
        if (id === null) {
            return;
        }

        try {
            set(await callAction(control, what, id));
            setError(null);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        }
    };

    return { page, error, setError, run };
}

/** The newest screencast frame, by long-polling: each answer comes when a newer frame exists. */
function useFrame(id: number | null, open: boolean): (Frame & { src: string }) | undefined {
    const [latest, setLatest] = useState<(Frame & { src: string }) | undefined>(undefined);

    useEffect(() => {
        if (id === null || !open) {
            return undefined;
        }

        const stop = new AbortController();
        const alive = () => !stop.signal.aborted;

        void (async () => {
            let after = 0;

            while (alive()) {
                const started = Date.now();

                try {
                    const next = await callAction(frame, { after }, id);

                    if (next !== null && alive()) {
                        after = next.seq;
                        setLatest({ ...next, src: `data:image/jpeg;base64,${next.image}` });
                    }
                } catch {
                    await sleep(2000);
                }

                // An answer with nothing in it that came at once must not turn into a busy loop.
                if (Date.now() - started < 500) {
                    await sleep(500);
                }
            }
        })();

        return () => {
            stop.abort();
        };
    }, [id, open]);

    return latest;
}

/** What the person does on the page, sent in order, a few at a time. */
function useInput(id: number | null, onError: (message: string) => void) {
    const queue = useRef<unknown[]>([]);
    const flushing = useRef(false);

    const flush = async (): Promise<void> => {
        if (flushing.current || id === null) {
            return;
        }

        flushing.current = true;

        try {
            while (queue.current.length > 0) {
                const events = queue.current.splice(0, 50);

                await callAction(input, { events }, id).catch((failure: unknown) => {
                    onError(failure instanceof Error ? failure.message : String(failure));

                    return true;
                });
            }
        } finally {
            flushing.current = false;
        }
    };

    return (event: unknown): void => {
        queue.current.push(event);
        void flush();
    };
}

function Stage({
    id,
    shot,
    onError,
}: {
    id: number | null;
    shot: (Frame & { src: string }) | undefined;
    onError: (message: string) => void;
}) {
    const send = useInput(id, onError);
    const image = useRef<HTMLImageElement>(null);
    const drag = useRef<{ x: number; y: number } | null>(null);
    const moved = useRef(false);

    if (shot === undefined) {
        return null;
    }

    /** CSS pixels of the page under a point of the screen. */
    const at = (clientX: number, clientY: number): { x: number; y: number } => {
        const rect = image.current?.getBoundingClientRect();

        return rect === undefined || rect.width === 0
            ? { x: 0, y: 0 }
            : {
                  x: ((clientX - rect.left) / rect.width) * shot.width,
                  y: ((clientY - rect.top) / rect.height) * shot.height,
              };
    };

    const down = (event: PointerEvent): void => {
        drag.current = { x: event.clientX, y: event.clientY };
        moved.current = false;
    };

    // A finger that drags scrolls the page; one that lifts without moving taps it.
    const move = (event: PointerEvent): void => {
        const start = drag.current;

        if (start === null || event.pointerType !== "touch") {
            return;
        }

        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;

        if (!moved.current && Math.hypot(dx, dy) < 6) {
            return;
        }

        moved.current = true;
        drag.current = { x: event.clientX, y: event.clientY };
        send({ type: "wheel", ...at(event.clientX, event.clientY), dx: -dx, dy: -dy });
    };

    const key = (event: KeyboardEvent): void => {
        if (MODIFIERS.has(event.key)) {
            return;
        }

        // A paste arrives as its own event, with the text.
        if ((event.ctrlKey || event.metaKey) && event.key === "v") {
            return;
        }

        event.preventDefault();
        send({
            type: "key",
            key: event.key,
            modifiers:
                (event.altKey ? 1 : 0) |
                (event.ctrlKey ? 2 : 0) |
                (event.metaKey ? 4 : 0) |
                (event.shiftKey ? 8 : 0),
        });
    };

    const paste = (event: ClipboardEvent): void => {
        event.preventDefault();
        send({ type: "text", text: event.clipboardData.getData("text") });
    };

    return (
        <div
            tabIndex={0}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a surface that forwards keys to the remote page: it holds no text of its own
            role="textbox"
            aria-multiline
            aria-label="Browser page"
            onKeyDown={key}
            onPaste={paste}
            onPointerDown={down}
            onPointerMove={move}
            onClick={(event) => {
                // A drag that scrolled the page is not a tap.
                if (moved.current) {
                    moved.current = false;

                    return;
                }

                send({
                    type: "click",
                    ...at(event.clientX, event.clientY),
                    count: Math.max(1, Math.min(3, event.detail)),
                });
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                send({ type: "click", ...at(event.clientX, event.clientY), button: "right" });
            }}
            onWheel={(event) => {
                send({
                    type: "wheel",
                    ...at(event.clientX, event.clientY),
                    dx: event.deltaX,
                    dy: event.deltaY,
                });
            }}
            className="bg-sunken flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden outline-none select-none"
        >
            <img
                ref={image}
                src={shot.src}
                alt=""
                draggable={false}
                className="max-h-full max-w-full object-contain"
            />
        </div>
    );
}

function Console({ id, count }: { id: number | null; count: number }) {
    const [lines, setLines] = useState<LogEntry[]>([]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            const next = await callAction(logs, undefined, id).catch(() => []);

            if (alive) {
                setLines(next);
            }
        })();

        return () => {
            alive = false;
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `count` grows with every console line: it is the trigger to read them again
    }, [id, count]);

    return (
        <div className="border-edge-soft text-meta max-h-40 shrink-0 overflow-y-auto border-t p-2 font-mono">
            {lines.length === 0 ? <span className="text-faint">The console is empty.</span> : null}
            {lines.map((line) => (
                <div
                    key={line.seq}
                    className={
                        line.level === "error"
                            ? "text-danger"
                            : line.level === "warning"
                              ? "text-warn"
                              : "text-muted"
                    }
                >
                    {line.level === "nav" ? `— ${line.text}` : line.text}
                </div>
            ))}
        </div>
    );
}

function IconButton({
    title,
    onClick,
    disabled,
    active,
    children,
}: {
    title: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled === true}
            onClick={onClick}
            className={`rounded-control hover:bg-raised hover:text-ink flex size-7 shrink-0 items-center justify-center disabled:opacity-40 disabled:hover:bg-transparent ${active === true ? "bg-raised text-ink" : "text-muted"}`}
        >
            {children}
        </button>
    );
}

export function BrowserPanel({ session }: PanelProps) {
    const id = session?.id ?? null;
    const { page, error, setError, run } = usePageState(id);
    const shot = useFrame(id, page?.open === true);
    const [draft, setDraft] = useState<string | null>(null);
    const [showConsole, setShowConsole] = useState(false);

    // What is typed shows while the field has focus; otherwise it shows where the page is.
    const address = draft ?? (page === undefined || page.url === "about:blank" ? "" : page.url);

    if (id === null) {
        return <p className="text-faint text-interface p-3">Open a session to use the browser.</p>;
    }

    if (page?.available === false) {
        return (
            <p className="text-muted text-interface p-3">
                No Chromium-based browser was found on this machine. Install Chromium or Chrome, or
                set PI_DURABLE_BROWSER to a browser's path.
            </p>
        );
    }

    const problem = error ?? page?.problem ?? null;

    return (
        <>
            <div className="border-edge-soft flex items-center gap-1 border-b p-2">
                <IconButton
                    title="Back"
                    disabled={page?.canGoBack !== true}
                    onClick={() => void run({ op: "back" })}
                >
                    <ArrowLeft className="size-4" />
                </IconButton>
                <IconButton
                    title="Forward"
                    disabled={page?.canGoForward !== true}
                    onClick={() => void run({ op: "forward" })}
                >
                    <ArrowRight className="size-4" />
                </IconButton>
                <IconButton
                    title={page?.loading === true ? "Stop" : "Reload"}
                    disabled={page?.open !== true}
                    onClick={() => void run({ op: page?.loading === true ? "stop" : "reload" })}
                >
                    {page?.loading === true ? (
                        <X className="size-4" />
                    ) : (
                        <RotateCw className="size-4" />
                    )}
                </IconButton>
                <form
                    className="min-w-0 flex-1"
                    onSubmit={(event) => {
                        event.preventDefault();

                        setDraft(null);

                        if (address.trim() !== "") {
                            void run({ op: "navigate", url: address });
                        }
                    }}
                >
                    <input
                        value={address}
                        title={
                            page?.open === true
                                ? `${page.viewport.width}×${page.viewport.height} · ${page.title}`
                                : undefined
                        }
                        placeholder="localhost:5173, example.com or a file path"
                        onChange={(event) => {
                            setDraft(event.target.value);
                        }}
                        onBlur={() => {
                            setDraft(null);
                        }}
                        className="rounded-control bg-sunken text-interface text-ink placeholder:text-faint w-full min-w-0 px-2.5 py-1 font-mono outline-none"
                    />
                </form>
                {PRESETS.map(({ name, icon: Icon }) => (
                    <IconButton
                        key={name}
                        title={name}
                        active={page?.preset === name}
                        onClick={() => void run({ op: "viewport", viewport: name })}
                    >
                        <Icon className="size-4" />
                    </IconButton>
                ))}
                <IconButton
                    title="Console"
                    active={showConsole}
                    onClick={() => {
                        setShowConsole((open) => !open);
                    }}
                >
                    <Terminal className="size-4" />
                </IconButton>
                {page !== undefined && page.errors > 0 ? (
                    <span className="text-meta text-danger">{page.errors}</span>
                ) : null}
            </div>

            {problem === null ? null : (
                <p className="text-meta text-danger px-3 py-1.5">{problem}</p>
            )}

            {page?.open === true ? (
                <Stage id={id} shot={shot} onError={setError} />
            ) : (
                <div className="text-faint text-interface flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                    <p>{page?.loading === true ? "Starting the browser…" : "Nothing is open."}</p>
                    <button
                        type="button"
                        onClick={() => void run({ op: "open" })}
                        className="rounded-control bg-raised text-ink hover:bg-edge-soft px-3 py-1"
                    >
                        Open the browser
                    </button>
                </div>
            )}

            {showConsole ? <Console id={id} count={page?.logs ?? 0} /> : null}
        </>
    );
}
