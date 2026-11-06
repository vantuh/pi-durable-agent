import { Maximize2, Minimize2, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import type { FolderPanel } from "@/extensions.ts";
import { clampPanelWidth } from "@/lib/panel-width.ts";
import type { PanelProps } from "@/sdk/types.ts";
import { ItemBoundary } from "@/ui/item-boundary.tsx";
import { PaneHeader } from "@/ui/pane.tsx";
import { ResizeHandle } from "@/ui/resize-handle.tsx";

export const panelKey = (panel: FolderPanel): string => `${panel.folder}:${panel.id}`;

/** Which panel is open, remembered per session. The closed one stays as `shown` until `forget`, so it can
 * be seen leaving; nothing is remembered across a change of session, where the panel was never open.
 * `last` is the panel opened most recently, kept after it closes, for the toggle to bring back. */
export function useOpenPanel(session: number | null): {
    shown: string | null;
    last: string | null;
    open: boolean;
    setOpen: (key: string | null) => void;
    forget: () => void;
} {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const [kept, setKept] = useState<{ session: number | null; key: string | null } | null>(null);
    const storageKey = `panel:${String(session)}`;
    const stored = session === null ? null : localStorage.getItem(storageKey);
    const shown = stored ?? (kept?.session === session ? kept.key : null);
    const lastKey = `panelLast:${String(session)}`;

    const setOpen = (key: string | null): void => {
        if (key === null) {
            localStorage.removeItem(storageKey);
            setKept({ session, key: stored });
        } else {
            localStorage.setItem(storageKey, key);
            localStorage.setItem(lastKey, key);
        }

        rerender();
    };

    return {
        shown,
        last: session === null ? null : localStorage.getItem(lastKey),
        open: stored !== null,
        setOpen,
        forget: () => {
            setKept(null);
        },
    };
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

const DRAWER = `border-edge-soft bg-panel absolute inset-0 border-l z-20 flex min-w-0 flex-col lg:relative lg:inset-auto lg:z-auto lg:w-[var(--panel-w,var(--panel-w-fit,min(46%,720px)))]`;
// Expanded, the panel takes the conversation's place, exactly the box the page frame takes, and the same
// fade. The drawer's width no longer applies: the row's own left offset does.
const OVER = `border-edge-soft bg-panel absolute inset-0 border-l z-20 flex min-w-0 flex-col animate-drop-in lg:absolute lg:inset-y-0 lg:right-0 lg:left-[var(--conversation-x,0px)] lg:z-30 lg:w-auto`;
const COLUMN = "lg:w-[var(--panel-w,var(--panel-w-fit,min(46%,720px)))] lg:shrink-0";

/**
 * The open panel, to the right of the conversation. Below `lg` it covers the screen, as the
 * sessions list does. A panel that asks for it fills the conversation instead, still the same
 * mounted body, so a live view inside it is not thrown away by the move. The body is the
 * extension's own; the frame and the close button are ours.
 */
export function PanelHost({
    panel,
    tabs,
    session,
    open,
    expanded,
    setExpanded,
    onClose,
    onLeft,
}: PanelProps & {
    panel: FolderPanel;
    tabs: ReactNode;
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
            data-expanded={expanded ? "" : undefined}
            data-leaving={open ? undefined : ""}
            onAnimationEnd={(event) => {
                // A child's own animation bubbles through here; only the panel's own end means it has left.
                if (!open && event.target === event.currentTarget) {
                    onLeft();
                }
            }}
            className={expanded ? OVER : DRAWER}
        >
            {expanded ? null : (
                <ResizeHandle
                    edge="left"
                    label="Resize panel"
                    onResize={(wanted, save) => setWidth(wanted, save ? widthKey(id) : null)}
                    base={(box) => box.getBoundingClientRect().width}
                    onReset={() => {
                        localStorage.removeItem(widthKey(id));
                        setWidth(null, null);
                    }}
                />
            )}

            {/* Pinned to the right edge while the panel widens: it comes in like a drawer, not a squashed card. */}
            <div className="flex min-h-0 flex-1 justify-end overflow-hidden">
                <div className={`flex w-full min-w-0 flex-col ${expanded ? "" : COLUMN}`}>
                    <PaneHeader className="gap-2">
                        {tabs}
                        {/* Below `lg` the drawer is already the screen, so there is nothing to fill. */}
                        <Hint label={expanded ? "Back to the sidebar" : "Full screen"}>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={expanded ? "Back to the sidebar" : "Full screen"}
                                aria-pressed={expanded}
                                onClick={() => {
                                    setExpanded(!expanded);
                                }}
                                className="max-lg:hidden"
                            >
                                {expanded ? (
                                    <Minimize2 className="size-4" />
                                ) : (
                                    <Maximize2 className="size-4" />
                                )}
                            </Button>
                        </Hint>
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
                    </PaneHeader>

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
