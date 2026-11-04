import { useEffect } from "react";

import { isSheet } from "../lib/narrow.ts";

/** A swipe counts only from this close to the left edge, so code blocks and tables keep their own horizontal scroll. */
const EDGE = 32;
/** How far right the finger travels before the swipe opens. */
const DISTANCE = 60;

/** A finger swiping right from the left edge calls `onOpen`, on a phone-wide screen only. */
export function useEdgeSwipe(onOpen: () => void): void {
    useEffect(() => {
        let start: { id: number; x: number; y: number } | null = null;

        const down = (event: TouchEvent) => {
            const touch = event.touches[0];

            start =
                event.touches.length === 1 &&
                touch !== undefined &&
                touch.clientX <= EDGE &&
                isSheet()
                    ? { id: touch.identifier, x: touch.clientX, y: touch.clientY }
                    : null;
        };
        const move = (event: TouchEvent) => {
            const from = start;
            const touch = [...event.touches].find((each) => each.identifier === from?.id);

            if (from === null || touch === undefined) {
                return;
            }

            const dx = touch.clientX - from.x;
            const dy = Math.abs(touch.clientY - from.y);

            if (dy > dx) {
                start = null;
            } else if (dx >= DISTANCE) {
                start = null;
                onOpen();
            }
        };
        const up = () => {
            start = null;
        };

        document.addEventListener("touchstart", down, { passive: true });
        document.addEventListener("touchmove", move, { passive: true });
        document.addEventListener("touchend", up);
        document.addEventListener("touchcancel", up);

        return () => {
            document.removeEventListener("touchstart", down);
            document.removeEventListener("touchmove", move);
            document.removeEventListener("touchend", up);
            document.removeEventListener("touchcancel", up);
        };
    }, [onOpen]);
}
