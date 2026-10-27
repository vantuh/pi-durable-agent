import { Gauge, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";

import { providers, readerFor, SETTINGS_CHANGED, type Bucket, type UsageResult } from "./refs.ts";

const REFRESH_MS = 60_000;
const POPOVER_WIDTH = 288;
const WARN_ABOVE = 70;
const DANGER_ABOVE = 90;

function tone(pct: number): string {
    return pct > DANGER_ABOVE ? "bg-danger" : pct > WARN_ABOVE ? "bg-warn" : "bg-accent";
}

/** "resets in 2d 3h", as the terminal's `/usage` says it. */
function until(resetsAt: number | null, now: number): string {
    if (resetsAt === null) {
        return "";
    }

    const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const parts = days > 0 ? [`${String(days)}d`] : [];

    if (hours > 0) {
        parts.push(`${String(hours)}h`);
    }

    if (days === 0) {
        parts.push(`${String(minutes % 60)}m`);
    }

    return `resets in ${parts.join(" ")}`;
}

function Bar({ pct, className }: { pct: number; className: string }) {
    return (
        <span className={`bg-raised overflow-hidden rounded-full ${className}`}>
            <span
                className={`${tone(pct)} h-full`}
                style={{ width: `${String(Math.min(100, Math.max(0, Math.round(pct))))}%` }}
            />
        </span>
    );
}

/** The data, kept fresh while a session is open; a new session or model reads the new provider. */
function useUsage(session: StatusProps["session"]) {
    const [data, setData] = useState<UsageResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const id = session?.id ?? null;
    const busy = session?.busy ?? false;
    const [tick, setTick] = useState(0);
    const forced = useRef(false);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const update = async () => {
            const fresh = forced.current;

            forced.current = false;

            try {
                const found = await callAction(providers, fresh ? { fresh } : undefined, id);

                if (alive) {
                    setData(found);
                    setFailure(null);
                }
            } catch (error) {
                if (alive) {
                    setFailure(error instanceof Error ? error.message : String(error));
                }
            }

            if (alive) {
                setLoading(false);
                timer = setTimeout(() => {
                    void update();
                }, REFRESH_MS);
            }
        };

        void update();

        return () => {
            alive = false;
            clearTimeout(timer);
        };
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a run ending (busy going false) has just spent some of the limit; tick is a manual refresh
    }, [id, busy, tick]);

    const refresh = useCallback(() => {
        forced.current = true;
        setLoading(true);
        setTick((previous) => previous + 1);
    }, []);

    // The toggles in the Extensions dialog change what the server asks: read again at once.
    useEffect(() => {
        window.addEventListener(SETTINGS_CHANGED, refresh);

        return () => {
            window.removeEventListener(SETTINGS_CHANGED, refresh);
        };
    }, [refresh]);

    return { data, loading, failure, refresh };
}

function Row({ bucket, now }: { bucket: Bucket; now: number }) {
    const reset = until(bucket.resetsAt, now);

    return (
        <div className="mb-2 last:mb-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted">{bucket.label}</span>
                <span className="text-ink font-mono tabular-nums">{Math.round(bucket.pct)}%</span>
            </div>
            <Bar pct={bucket.pct} className="my-1 flex h-1.5 w-full" />
            {reset === "" ? null : <div className="text-faint">{reset}</div>}
        </div>
    );
}

function Popover({
    anchor,
    reader,
    result,
    onRefresh,
    onClose,
}: {
    anchor: HTMLElement;
    reader: string | null;
    result: { data: UsageResult | null; loading: boolean; failure: string | null };
    onRefresh: () => void;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    // Above the button, since the status bar is at the bottom; kept inside the window on a phone.
    const [place] = useState(() => {
        const box = anchor.getBoundingClientRect();
        const width = Math.min(POPOVER_WIDTH, innerWidth - 16);
        const left = Math.min(
            Math.max(8, box.left + box.width / 2 - width / 2),
            innerWidth - width - 8,
        );

        return { bottom: innerHeight - box.top + 8, left };
    });

    useEffect(() => {
        const away = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !ref.current?.contains(event.target) &&
                !anchor.contains(event.target)
            ) {
                onClose();
            }
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("pointerdown", away);
        document.addEventListener("keydown", escape);

        return () => {
            document.removeEventListener("pointerdown", away);
            document.removeEventListener("keydown", escape);
        };
    }, [anchor, onClose]);

    return createPortal(
        <dialog
            ref={ref}
            open
            aria-label="Provider usage"
            style={place}
            className="border-edge bg-panel text-meta text-ink fixed top-auto right-auto z-50 m-0 max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border p-3 shadow-lg"
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="text-ink font-medium">Provider usage</span>
                <button
                    type="button"
                    title="Refresh"
                    aria-label="Refresh"
                    onClick={onRefresh}
                    className="text-muted hover:text-ink"
                >
                    {result.loading ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="size-3.5" />
                    )}
                </button>
            </div>
            {result.failure === null ? null : <p className="text-danger mb-2">{result.failure}</p>}
            {result.data?.providers.length === 0 ? (
                <p className="text-faint">No signed-in provider reports limits.</p>
            ) : null}
            {result.data?.providers.map((provider) => (
                <section
                    key={provider.id}
                    className={`border-edge-soft mb-3 rounded-lg border p-2 last:mb-0 ${provider.id === reader ? "bg-raised" : ""}`}
                >
                    <h4 className="text-ink mb-1.5 font-medium">{provider.name}</h4>
                    {provider.error === undefined ? null : (
                        <p className="text-danger">{provider.error}</p>
                    )}
                    {provider.buckets.map((bucket) => (
                        <Row key={bucket.label} bucket={bucket} now={result.data?.at ?? 0} />
                    ))}
                </section>
            ))}
            {result.data === null && result.failure === null ? (
                <p className="text-faint">Loading…</p>
            ) : null}
        </dialog>,
        document.body,
    );
}

function UsageLimits({ session }: StatusProps) {
    const usage = useUsage(session);
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const reader = readerFor(session?.model ?? null);
    const close = useCallback(() => {
        setOpen(false);
    }, []);

    if (session === null) {
        return null;
    }

    const provider = usage.data?.providers.find((candidate) => candidate.id === reader);
    const bucket = provider?.buckets.find((candidate) => candidate.session);
    const title =
        bucket === undefined
            ? "Provider usage"
            : `${provider?.name ?? ""}: ${String(Math.round(bucket.pct))}% of the 5-hour limit used. ${until(bucket.resetsAt, usage.data?.at ?? 0)}`;

    return (
        <>
            <button
                ref={setAnchor}
                type="button"
                title={title}
                aria-label={title}
                aria-expanded={open}
                onClick={() => {
                    setOpen((previous) => !previous);
                }}
                className="text-faint hover:text-ink hover:bg-sunken aria-expanded:bg-sunken hidden shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono sm:flex"
            >
                {bucket === undefined ? (
                    <Gauge className="size-3.5" />
                ) : (
                    <>
                        <span>5h</span>
                        <Bar pct={bucket.pct} className="flex h-1 w-9" />
                        {String(Math.round(bucket.pct))}%
                    </>
                )}
            </button>
            {open && anchor !== null ? (
                <Popover
                    anchor={anchor}
                    reader={reader}
                    result={usage}
                    onRefresh={() => {
                        usage.refresh();
                    }}
                    onClose={close}
                />
            ) : null}
        </>
    );
}

export default {
    status: [{ id: "five-hour", slot: "center", component: UsageLimits }],
} satisfies WebExtension;
