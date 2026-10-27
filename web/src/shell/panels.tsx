import { X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect } from "react";

import type { FolderPanel } from "../extensions.ts";
import { clampPanelWidth } from "../lib/panel-width.ts";
import type { PanelProps } from "../sdk/types.ts";
import { ItemBoundary } from "../ui/item-boundary.tsx";

export const panelKey = (panel: FolderPanel): string => `${panel.folder}:${panel.id}`;

/** One header button per panel; the open one stays raised. */
export function PanelButtons({
    panels,
    open,
    onToggle,
}: {
    panels: readonly FolderPanel[];
    open: string | null;
    onToggle: (key: string) => void;
}) {
    return panels.map((panel) => {
        const key = panelKey(panel);

        return (
            <button
                key={key}
                type="button"
                title={panel.title}
                onClick={() => {
                    onToggle(key);
                }}
                className={`rounded-control hover:bg-raised hover:text-ink flex size-6 items-center justify-center ${open === key ? "bg-raised text-ink" : "text-muted"}`}
            >
                {panel.icon}
            </button>
        );
    });
}

const WIDTH_KEY = "panelWidth";

function savedWidth(): number | null {
    const width = Number(localStorage.getItem(WIDTH_KEY));

    return width > 0 ? width : null;
}

/** Without a width the stylesheet's default (46%, at most 720px) applies. */
function setWidth(wanted: number | null, save: boolean): number | null {
    const root = document.documentElement;

    if (wanted === null) {
        root.style.removeProperty("--panel-w");

        return null;
    }

    const width = clampPanelWidth(wanted);

    root.style.setProperty("--panel-w", `${String(width)}px`);

    if (save) {
        localStorage.setItem(WIDTH_KEY, String(width));
    }

    return width;
}

/** Drag the panel's left edge, or press the arrow keys on it, to resize it; a double click resets it. */
function ResizeHandle() {
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
            width = setWidth(right - each.clientX, false);
        };

        // Fires after pointerup and pointercancel alike, so one listener ends the drag.
        const stop = (): void => {
            root.classList.remove("resizing");
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("lostpointercapture", stop);

            if (width !== null) {
                setWidth(width, true);
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
                    setWidth(current + step, true);
                }
            }}
            onDoubleClick={() => {
                localStorage.removeItem(WIDTH_KEY);
                setWidth(null, false);
            }}
            className="group absolute inset-y-0 -left-2 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
        >
            <span className="bg-accent absolute top-1/2 left-[3px] h-9 w-0.5 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
        </button>
    );
}

/**
 * The open panel, to the right of the conversation. Below `lg` it covers the screen, as the
 * sessions list does. The body is the extension's own; the frame and the close button are ours.
 */
export function PanelHost({
    panel,
    session,
    onClose,
}: PanelProps & {
    panel: FolderPanel;
}) {
    const Body = panel.component;

    useEffect(() => {
        setWidth(savedWidth(), false);
    }, []);

    return (
        <aside className="rounded-card border-edge-soft bg-canvas fixed inset-2 z-20 flex min-w-0 flex-col border lg:relative lg:inset-auto lg:z-auto lg:w-[var(--panel-w,min(46%,720px))]">
            <ResizeHandle />
            <header className="border-edge-soft flex items-center justify-between border-b px-3 py-2.5">
                <h2 className="text-interface text-ink font-medium">{panel.title}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    title="Close"
                    className="rounded-control text-muted hover:bg-raised flex size-6 items-center justify-center"
                >
                    <X className="size-4" />
                </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
                <ItemBoundary name={panelKey(panel)}>
                    <Body key={session?.id ?? "none"} session={session} onClose={onClose} />
                </ItemBoundary>
            </div>
        </aside>
    );
}
