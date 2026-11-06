import { Gauge, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty } from "@/components/ui/empty.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Hint } from "@/components/ui/tooltip.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { StatusProps, WebExtension } from "@/sdk/types.ts";
import { Loading } from "@/ui/loading.tsx";
import { PANE } from "@/ui/pane.tsx";

import { messageOf } from "../../shared/guards.ts";
import { providers, readerFor, SETTINGS_CHANGED, type Bucket, type UsageResult } from "./refs.ts";

const REFRESH_MS = 5 * 60_000;
const WARN_ABOVE = 70;
const DANGER_ABOVE = 90;

function toneOf(pct: number): "accent" | "warn" | "danger" {
    return pct > DANGER_ABOVE ? "danger" : pct > WARN_ABOVE ? "warn" : "accent";
}

/** The bar's fill, 0 to 100: the rounded percentage beside it, which is what the width used to be. */
const fillOf = (pct: number): number => Math.min(100, Math.max(0, Math.round(pct)));

/** "resets in 2d 3h", as the terminal's `/usage` says it. */
/** The status bar is narrow: long window labels shrink there; the popover keeps them whole. */
const SHORT: Record<string, string | undefined> = { "5 hours": "5h", Credits: "Cred." };

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

/** Every provider's limits, read on a slow timer and when the popover opens; a session switch only picks another row. */
function useUsage() {
    const [data, setData] = useState<UsageResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const forced = useRef(false);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const update = async () => {
            const fresh = forced.current;

            forced.current = false;

            try {
                const found = await callAction(providers, fresh ? { fresh } : undefined, null);

                if (alive) {
                    setData(found);
                    setFailure(null);
                }
            } catch (error) {
                if (alive) {
                    setFailure(messageOf(error));
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
        // oxlint-disable-next-line react/exhaustive-effect-dependencies -- tick is a manual refresh
    }, [tick]);

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
            <Progress
                value={fillOf(bucket.pct)}
                tone={toneOf(bucket.pct)}
                className="my-1 h-1.5 w-full"
                aria-label={bucket.label}
            />
            {reset === "" ? null : <div className="text-faint">{reset}</div>}
        </div>
    );
}

function Panel({
    reader,
    result,
    onRefresh,
}: {
    reader: string | null;
    result: { data: UsageResult | null; loading: boolean; failure: string | null };
    onRefresh: () => void;
}) {
    return (
        <PopoverContent
            side="top"
            aria-label="Provider usage"
            size="panel"
            className="text-meta w-72 p-0"
        >
            {/* The cap sits on the viewport: a popover capped by max-height gives the area no height to fill. */}
            <ScrollArea viewportProps={{ className: "max-h-[70vh]" }}>
                <div className="p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-ink font-medium">Provider usage</span>
                        <Hint label="Refresh">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Refresh"
                                onClick={onRefresh}
                            >
                                {result.loading ? (
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="size-3.5" />
                                )}
                            </Button>
                        </Hint>
                    </div>
                    {result.failure === null ? null : (
                        <Alert className="mb-2">{result.failure}</Alert>
                    )}
                    {result.data?.providers.length === 0 ? (
                        <Empty>No signed-in provider reports limits.</Empty>
                    ) : null}
                    {result.data?.providers.map((provider) => (
                        <section
                            key={provider.id}
                            className={`${PANE} mb-3 p-2 last:mb-0 ${provider.id === reader ? "bg-raised" : ""}`}
                        >
                            <h4 className="text-ink mb-1.5 font-medium">{provider.name}</h4>
                            {provider.error === undefined ? null : <Alert>{provider.error}</Alert>}
                            {provider.buckets.map((bucket) => (
                                <Row
                                    key={bucket.label}
                                    bucket={bucket}
                                    now={result.data?.at ?? 0}
                                />
                            ))}
                        </section>
                    ))}
                    {result.data === null && result.failure === null ? <Loading /> : null}
                </div>
            </ScrollArea>
        </PopoverContent>
    );
}

function UsageLimits({ session }: StatusProps) {
    const usage = useUsage();
    const [open, setOpen] = useState(false);
    const reader = readerFor(session?.model ?? null);

    if (session === null) {
        return null;
    }

    const provider = usage.data?.providers.find((candidate) => candidate.id === reader);
    const bucket = provider?.buckets.find((candidate) => candidate.session);
    const title =
        bucket === undefined
            ? "Provider usage"
            : `${provider?.name ?? ""}: ${String(Math.round(bucket.pct))}% used (${bucket.label}). ${until(bucket.resetsAt, usage.data?.at ?? 0)}`;

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                // Opening asks the provider again, and only opening: a phone that closes a popup has spent nothing.
                if (next) {
                    usage.refresh();
                }

                setOpen(next);
            }}
        >
            <Hint label={title}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={title}
                        className="text-faint hover:bg-sunken aria-expanded:bg-sunken shrink-0 px-1.5 py-0.5 font-mono"
                    >
                        {bucket === undefined ? (
                            <Gauge className="size-3.5" />
                        ) : (
                            <>
                                <span>{SHORT[bucket.label] ?? bucket.label}</span>
                                <Progress
                                    value={fillOf(bucket.pct)}
                                    tone={toneOf(bucket.pct)}
                                    className="w-9"
                                    aria-label={bucket.label}
                                />
                                {String(Math.round(bucket.pct))}%
                            </>
                        )}
                    </Button>
                </PopoverTrigger>
            </Hint>
            <Panel
                reader={reader}
                result={usage}
                onRefresh={() => {
                    usage.refresh();
                }}
            />
        </Popover>
    );
}

export default {
    status: [{ id: "five-hour", slot: "end", component: UsageLimits }],
} satisfies WebExtension;
