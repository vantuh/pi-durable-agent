import { type KeyboardEvent, type PointerEvent, useEffect, useEffectEvent, useRef } from "react";

import type { Frame } from "../refs.ts";
import { useInput } from "./use-input.ts";

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function Stage({
    id,
    shot,
    onError,
}: {
    id: number | null;
    shot: (Frame & { src: string }) | undefined;
    onError: (message: string) => void;
}) {
    const send = useInput(id, onError);
    const sendText = useEffectEvent((text: string) => send({ type: "text", text }));
    const surface = useRef<HTMLDivElement>(null);
    const image = useRef<HTMLImageElement>(null);
    const drag = useRef<{ x: number; y: number } | null>(null);
    const moved = useRef(false);

    // Firefox gives a paste to the element last edited, not the focused page: take it on the document, in the
    // capture phase, before that element's own paste handler (the composer's) acts on it.
    useEffect(() => {
        const paste = (event: globalThis.ClipboardEvent): void => {
            const text = event.clipboardData?.getData("text") ?? "";

            if (
                surface.current === null ||
                document.activeElement !== surface.current ||
                text === ""
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            sendText(text);
        };

        document.addEventListener("paste", paste, true);

        return () => document.removeEventListener("paste", paste, true);
    }, []);

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

    return (
        <div
            ref={surface}
            tabIndex={0}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a surface that forwards keys to the remote page: it holds no text of its own
            role="textbox"
            aria-multiline
            aria-label="Browser page"
            onKeyDown={key}
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
            className="bg-sunken focus-visible:ring-accent flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-inset"
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
