import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * The strip on one side of a resizable box: drag it, or press the arrow keys on it, to resize; a double click
 * resets. `edge` is the side of the box it sits on, and dragging it away from the box widens it. The caller owns
 * the bounds, the stylesheet variable and the storage: `onResize` applies a wanted width and returns the one it
 * settled on, `save` being true when the person is done; `base` is the width an arrow key steps from.
 */
export function ResizeHandle({
    edge,
    label,
    onResize,
    base,
    onReset,
}: {
    edge: "left" | "right";
    label: string;
    onResize: (wanted: number, save: boolean) => number | null;
    base: (box: HTMLElement) => number;
    onReset: () => void;
}) {
    const start = (event: ReactPointerEvent<HTMLButtonElement>): void => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        const handle = event.currentTarget;
        const box = handle.parentElement?.getBoundingClientRect();
        const anchor = (edge === "right" ? box?.left : box?.right) ?? 0;
        const root = document.documentElement;
        let width: number | null = null;

        const move = (each: PointerEvent): void => {
            width = onResize(
                edge === "right" ? each.clientX - anchor : anchor - each.clientX,
                false,
            );
        };

        // Fires after pointerup and pointercancel alike, so one listener ends the drag.
        const stop = (): void => {
            root.classList.remove("resizing");
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("lostpointercapture", stop);

            if (width !== null) {
                onResize(width, true);
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
            aria-label={label}
            title="Drag to resize, double-click to reset"
            onPointerDown={start}
            onKeyDown={(event) => {
                const widen = edge === "right" ? "ArrowRight" : "ArrowLeft";
                const box = event.currentTarget.parentElement;

                if (box !== null && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                    event.preventDefault();
                    onResize(base(box) + (event.key === widen ? 16 : -16), true);
                }
            }}
            onDoubleClick={onReset}
            className={`group absolute inset-y-0 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block ${
                edge === "right" ? "-right-2" : "-left-2"
            }`}
        >
            {/* Not a step: 3px centres the 2px grip in the handle's 8px strip. */}
            <span className="bg-accent absolute top-1/2 left-[3px] h-9 w-0.5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
        </button>
    );
}
