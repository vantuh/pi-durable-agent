import { Flame, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { isPlainClick, sessionHref } from "@/lib/route.ts";
import { toast } from "@/lib/toast.ts";
import { callAction } from "@/sdk/actions.ts";
import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";

import { TTL } from "./due.ts";
import {
    set as setAction,
    state as stateAction,
    stop as stopAction,
    type WarmSession,
    type WarmState,
} from "./refs.ts";

const POLL_MS = 60_000;
const POPOVER_WIDTH = 256;

const tokens = (count = 0) =>
    count >= 1000 ? `${String(Math.round(count / 1000))}k` : String(count);

/** Local time on a 24-hour dial, as the rest of the app writes it: 21:43, never 09:43 PM. */
const clock = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** How long ago, in the words the rest of the shell uses. */
function ago(at: number): string {
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));

    if (minutes < 1) {
        return "just now";
    }

    return minutes < 60
        ? `${String(minutes)} min ago`
        : `${String(Math.round(minutes / 60))} h ago`;
}

/** Where the cache stands: warm until the hour after the last request ends, else cold. */
function cacheLine(warm: WarmState, now: number): string {
    if (warm.lastRequest === undefined) {
        return "No request on the cache yet";
    }

    const until = warm.lastRequest + TTL;

    return until > now ? `Warm until ${clock(until)}` : `Cold since ${clock(until)}`;
}

/** Why no ping is coming, or when the next one is. */
function nextLine(warm: WarmState, now: number): string {
    if (!warm.on) {
        return "Off";
    }

    if (warm.nextAt !== undefined) {
        return `Next ping ${clock(Math.max(now, warm.nextAt))}`;
    }

    if (
        warm.last?.error !== undefined &&
        warm.lastRequest !== undefined &&
        warm.last.at >= warm.lastRequest
    ) {
        return "Waiting for the next answer";
    }

    if (warm.lastRequest !== undefined && warm.lastRequest + TTL <= now) {
        return "Cache is cold";
    }

    return "Stopped: no input from you for 8 h";
}

function Panel({
    warm,
    rows,
    current,
    anchor,
    now,
    onToggle,
    onStop,
    onOpen,
    onClose,
}: {
    warm: WarmState;
    /** Every conversation a ping is coming for. */
    rows: WarmSession[];
    /** The conversation the user is in: listed, but not a link. */
    current: number;
    anchor: HTMLElement;
    now: number;
    onToggle: (on: boolean) => void;
    onStop: (session: number, label: string) => void;
    onOpen: (session: number) => void;
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

    const failed = warm.last?.error !== undefined;

    return createPortal(
        <dialog
            ref={ref}
            open
            aria-label="Keep warm"
            style={place}
            className="border-edge bg-panel text-meta text-ink fixed top-auto right-auto z-50 m-0 max-h-[70vh] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border p-3 font-mono shadow-lg"
        >
            <div className="flex items-center justify-between gap-3">
                <span className="text-ink">Keep this context warm</span>
                <Switch
                    checked={warm.on}
                    onCheckedChange={onToggle}
                    aria-label="Keep this context warm"
                />
            </div>
            <Separator className="mt-2" />
            <div className="text-faint space-y-1 pt-2">
                <div className="text-muted">{cacheLine(warm, now)}</div>
                <div>{nextLine(warm, now)}</div>
                {warm.last === undefined ? null : (
                    <div className={failed ? "text-danger" : undefined}>
                        Last ping {ago(warm.last.at)}
                        {failed
                            ? `: ${warm.last.error ?? ""}`
                            : ` · read ${tokens(warm.last.read)}, wrote ${tokens(warm.last.write)}`}
                    </div>
                )}
                <div className="pt-1">
                    One small request 55 min after the last, until you have been away 8 h.
                </div>
            </div>
            {rows.length === 0 ? null : (
                <>
                    <Separator className="mt-2" />
                    <div className="pt-2">
                        <div className="text-faint mb-1">Warming</div>
                        {rows.map((row) => (
                            <div key={row.id} className="flex items-center gap-2">
                                {row.id === current ? (
                                    <span
                                        aria-current="true"
                                        className="text-ink min-w-0 flex-1 truncate"
                                    >
                                        {row.label}
                                    </span>
                                ) : (
                                    <a
                                        href={sessionHref(row.id)}
                                        onClick={(event) => {
                                            // A modified click is the browser's: a new tab, and the popover stays.
                                            if (isPlainClick(event)) {
                                                event.preventDefault();
                                                onOpen(row.id);
                                                onClose();
                                            }
                                        }}
                                        className="text-muted hover:text-ink min-w-0 flex-1 truncate hover:underline"
                                    >
                                        {row.label}
                                    </a>
                                )}
                                <span className="text-faint shrink-0 text-right tabular-nums">
                                    {clock(row.nextAt)}
                                </span>
                                <Hint
                                    label={`Stop warming ${row.label} until you write in it again`}
                                >
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Stop warming ${row.label}`}
                                        onClick={() => {
                                            onStop(row.id, row.label);
                                        }}
                                        className="text-faint shrink-0"
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </Hint>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </dialog>,
        document.body,
    );
}

function KeepWarm({ session, openSession }: StatusItemProps) {
    const [warm, setWarm] = useState<WarmState | null>(null);
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const id = session?.id ?? null;

    const read = useCallback(async () => {
        if (id === null) {
            return;
        }

        try {
            setWarm(await callAction(stateAction, undefined, id));
            setNow(Date.now());
        } catch {
            // A failed poll keeps the last state; the next one asks again.
        }
    }, [id]);

    useEffect(() => {
        // The first reading; every later one is the timer's.
        // oxlint-disable-next-line react/set-state-in-effect -- read() sets state after its await, not during the effect
        void read();

        const timer = setInterval(() => {
            void read();
        }, POLL_MS);

        return () => {
            clearInterval(timer);
        };
    }, [read]);

    const close = useCallback(() => {
        setOpen(false);
    }, []);

    if (session === null || warm === null) {
        return null;
    }

    const toggle = (on: boolean) => {
        callAction(setAction, { on }, id)
            .then(setWarm)
            // A failure leaves the switch as it was.
            .catch(() => undefined);
    };

    const stopWarming = (sessionId: number, label: string) => {
        void (async () => {
            try {
                setWarm(await callAction(stopAction, { id: sessionId }, id));
                toast.success(`Stopped warming “${label}”`);
            } catch {
                // The row stays where it was; the next poll asks again.
                toast.error("Could not stop warming that session. Please try again.");
            }
        })();
    };

    return (
        <>
            <Hint label={`Keep warm: ${cacheLine(warm, now).toLowerCase()}`}>
                <Button
                    ref={setAnchor}
                    variant="ghost"
                    size="sm"
                    aria-label="Keep warm"
                    aria-expanded={open}
                    onClick={() => {
                        setNow(Date.now());
                        setOpen((previous) => !previous);
                    }}
                    className={`hover:bg-sunken aria-expanded:bg-sunken shrink-0 px-1.5 py-0.5 font-mono ${
                        warm.on ? "text-ember" : "text-faint/60"
                    }`}
                >
                    <Flame className="size-3.5" />
                    warm
                </Button>
            </Hint>
            {open && anchor !== null ? (
                <Panel
                    warm={warm}
                    rows={warm.sessions}
                    current={session.id}
                    anchor={anchor}
                    now={now}
                    onToggle={toggle}
                    onStop={stopWarming}
                    onOpen={openSession}
                    onClose={close}
                />
            ) : null}
        </>
    );
}

export default {
    status: [{ id: "warm", slot: "end", component: KeepWarm }],
} satisfies WebExtension;
