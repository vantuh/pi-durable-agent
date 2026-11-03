import { X } from "lucide-react";
import {
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useLayoutEffect,
    useReducer,
    useRef,
    useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

import type { FolderPanel } from "../extensions.ts";
import { clampPanelWidth } from "../lib/panel-width.ts";
import type { PanelProps, StatusProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export const panelKey = (panel: FolderPanel): string => `${panel.folder}:${panel.id}`;

/** Which panel is open, remembered per session. The closed one stays as `shown` until `forget`, so it can
 * be seen leaving; nothing is remembered across a change of session, where the panel was never open. */
export function useOpenPanel(session: number | null): {
    shown: string | null;
    open: boolean;
    setOpen: (key: string | null) => void;
    forget: () => void;
} {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const [kept, setKept] = useState<{ session: number | null; key: string | null } | null>(null);
    const storageKey = `panel:${String(session)}`;
    const stored = session === null ? null : localStorage.getItem(storageKey);
    const shown = stored ?? (kept?.session === session ? kept.key : null);

    const setOpen = (key: string | null): void => {
        if (key === null) {
            localStorage.removeItem(storageKey);
            setKept({ session, key: stored });
        } else {
            localStorage.setItem(storageKey, key);
        }

        rerender();
    };

    return {
        shown,
        open: stored !== null,
        setOpen,
        forget: () => {
            setKept(null);
        },
    };
}

/** One header button per panel; the open one stays raised. */
export function PanelButtons({
    panels,
    session,
    open,
    onToggle,
}: {
    panels: readonly FolderPanel[];
    session: StatusProps["session"];
    open: string | null;
    onToggle: (key: string) => void;
}) {
    return panels.map((panel) => {
        const key = panelKey(panel);
        const Count = panel.badge;

        return (
            <Hint key={key} label={panel.title}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={panel.title}
                    onClick={() => {
                        onToggle(key);
                    }}
                    className={`relative ${open === key ? "bg-raised text-ink" : ""}`}
                >
                    {panel.icon}
                    {Count === undefined ? null : (
                        <Badge
                            tone="accent"
                            className="pointer-events-none absolute -top-1 -right-1 h-3.5 min-w-3.5 justify-center px-1 leading-none empty:hidden"
                        >
                            <ItemBoundary name={`${key}:badge`}>
                                <Count session={session} />
                            </ItemBoundary>
                        </Badge>
                    )}
                </Button>
            </Hint>
        );
    });
}

const widthKey = (session: number | undefined): string => `panelWidth:${String(session)}`;

function savedWidth(session: number | undefined): number | null {
    const width = Number(localStorage.getItem(widthKey(session)));

    return width > 0 ? width : null;
}

/** Without a width the stylesheet's default (46%, at most 720px) applies. */
function setWidth(wanted: number | null, save: string | null): number | null {
    const root = document.documentElement;

    if (wanted === null) {
        root.style.removeProperty("--panel-w");

        return null;
    }

    const width = clampPanelWidth(wanted);

    root.style.setProperty("--panel-w", `${String(width)}px`);

    if (save !== null) {
        localStorage.setItem(save, String(width));
    }

    return width;
}

/** Drag the panel's left edge, or press the arrow keys on it, to resize it; a double click resets it. */
function ResizeHandle({ storageKey }: { storageKey: string }) {
    const start = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        const handle = event.currentTarget;
        const right = handle.parentElement?.getBoundingClientRect().right ?? 0;
        const root = document.documentElement;
        let width: number | null = null;

        const move = (each: PointerEvent): void => {
            width = setWidth(right - each.clientX, null);
        };

        // Fires after pointerup and pointercancel alike, so one listener ends the drag.
        const stop = (): void => {
            root.classList.remove("resizing");
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("lostpointercapture", stop);

            if (width !== null) {
                setWidth(width, storageKey);
            }
        };

        root.classList.add("resizing");
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", stop);
    };

    return (
        <button
            type="button"
            aria-label="Resize panel"
            title="Drag to resize, double-click to reset"
            onPointerDown={start}
            onKeyDown={(event) => {
                const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key];
                const current = event.currentTarget.parentElement?.getBoundingClientRect().width;

                if (step !== undefined && current !== undefined) {
                    event.preventDefault();
                    setWidth(current + step, storageKey);
                }
            }}
            onDoubleClick={() => {
                localStorage.removeItem(storageKey);
                setWidth(null, null);
            }}
            className="group absolute inset-y-0 -left-2 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
        >
            {/* Not a step: 3px centres the 2px grip in the handle's 8px strip. */}
            <span className="bg-accent absolute top-1/2 left-[3px] h-9 w-0.5 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
        </button>
    );
}

const DRAWER =
    "rounded-card border-edge-soft bg-canvas fixed inset-2 z-20 flex min-w-0 flex-col border lg:relative lg:inset-auto lg:z-auto lg:w-[var(--panel-w,var(--panel-w-fit,min(46%,720px)))]";
// Expanded, the panel takes the conversation's place, exactly the box the page frame takes, and the same
// fade. The drawer's width no longer applies: the row's own left offset does.
const OVER =
    "rounded-card border-edge-soft bg-canvas fixed inset-2 z-20 flex min-w-0 flex-col border animate-drop-in lg:absolute lg:inset-y-0 lg:right-0 lg:left-[var(--conversation-x,0px)] lg:z-30 lg:w-auto";
const COLUMN = "lg:w-[var(--panel-w,var(--panel-w-fit,min(46%,720px)))] lg:shrink-0";

/**
 * The open panel, to the right of the conversation. Below `lg` it covers the screen, as the
 * sessions list does. A panel that asks for it fills the conversation instead, still the same
 * mounted body, so a live view inside it is not thrown away by the move. The body is the
 * extension's own; the frame and the close button are ours.
 */
export function PanelHost({
    panel,
    session,
    open,
    expanded,
    setExpanded,
    onClose,
    onLeft,
}: PanelProps & {
    panel: FolderPanel;
    open: boolean;
    onLeft: () => void;
}) {
    const Body = panel.component;

    const id = session?.id;
    const frame = useRef<HTMLElement>(null);

    // Before paint, so switching sessions does not flash the previous session's width.
    useLayoutEffect(() => {
        setWidth(savedWidth(id), null);
    }, [id]);

    // Escape gives the conversation back, as it does for a dialog. A dialog of its own keeps the key,
    // a confirmation included: one Escape closes one thing.
    useEffect(() => {
        if (!expanded) {
            return undefined;
        }

        const onKey = (event: KeyboardEvent): void => {
            if (
                event.key === "Escape" &&
                document.querySelector('[role="dialog"], [role="alertdialog"]') === null
            ) {
                setExpanded(false);
            }
        };

        window.addEventListener("keydown", onKey);

        return () => {
            window.removeEventListener("keydown", onKey);
        };
    }, [expanded, setExpanded]);

    // Where the conversation starts in the row: the sidebar's width is the browser's business (it resizes
    // and collapses), so the offset is measured rather than read off a custom property.
    useLayoutEffect(() => {
        const aside = frame.current;
        const row = aside?.parentElement ?? null;
        const conversation = row?.querySelector('[data-slot="conversation"]') ?? null;

        if (!expanded || aside === null || row === null || conversation === null) {
            return undefined;
        }

        const fit = (): void => {
            const offset =
                conversation.getBoundingClientRect().left - row.getBoundingClientRect().left;

            aside.style.setProperty("--conversation-x", `${String(Math.round(offset))}px`);
        };

        const sizes = new ResizeObserver(fit);

        fit();
        sizes.observe(row);
        sizes.observe(conversation);

        return () => {
            sizes.disconnect();
        };
    }, [expanded]);

    // The default width as a number: the column inside the panel keeps the width the panel ends at while
    // the panel itself widens, instead of rewrapping on every frame.
    useLayoutEffect(() => {
        const aside = frame.current;
        const row = aside?.parentElement ?? null;

        if (aside === null || row === null) {
            return undefined;
        }

        const fit = (): void => {
            const width = Math.min(Math.round(row.clientWidth * 0.46), 720);

            aside.style.setProperty("--panel-w-fit", `${String(width)}px`);
        };

        const sizes = new ResizeObserver(fit);

        fit();
        sizes.observe(row);

        return () => {
            sizes.disconnect();
        };
    }, []);

    return (
        <aside
            ref={frame}
            data-slot="panel-host"
            data-leaving={open ? undefined : ""}
            onAnimationEnd={(event) => {
                // A child's own animation bubbles through here; only the panel's own end means it has left.
                if (!open && event.target === event.currentTarget) {
                    onLeft();
                }
            }}
            className={expanded ? OVER : DRAWER}
        >
            {expanded ? null : <ResizeHandle storageKey={widthKey(id)} />}

            {/* Pinned to the right edge while the panel widens: it comes in like a drawer, not a squashed card. */}
            <div className="flex min-h-0 flex-1 justify-end overflow-hidden">
                <div className={`flex w-full min-w-0 flex-col ${expanded ? "" : COLUMN}`}>
                    <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2.5">
                        <h2 className="text-interface text-ink font-medium">{panel.title}</h2>
                        <Hint label="Close">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Close"
                                onClick={onClose}
                            >
                                <X className="size-4" />
                            </Button>
                        </Hint>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col">
                        <ItemBoundary name={panelKey(panel)}>
                            <Body
                                key={session?.id ?? "none"}
                                session={session}
                                onClose={onClose}
                                expanded={expanded}
                                setExpanded={setExpanded}
                            />
                        </ItemBoundary>
                    </div>
                </div>
            </div>
        </aside>
    );
}
