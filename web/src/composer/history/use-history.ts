import { type KeyboardEvent, useRef } from "react";

import { setComposerDraft } from "@/sdk/composer.ts";

import { loadHistory } from "./history-store.ts";

export function useHistory(sessionId: string) {
    // Position in history while browsing with the arrows (null: not browsing) and the draft to come back to.
    const browse = useRef<{ at: number; draft: string } | null>(null);
    const reset = (): void => {
        browse.current = null;
    };
    const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        const up = event.key === "ArrowUp";
        const down = event.key === "ArrowDown";

        if (
            (up || down) &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.nativeEvent.isComposing
        ) {
            const box = event.currentTarget;
            const { selectionStart, selectionEnd, value } = box;
            const collapsed = selectionStart === selectionEnd;
            // Only leave the text when the caret is on its first (up) or last (down) line.
            const edge = up
                ? !value.slice(0, selectionStart).includes("\n")
                : !value.slice(selectionEnd).includes("\n");

            if (collapsed && edge) {
                const past = loadHistory(sessionId);
                const state = browse.current;
                let next: string | undefined;

                if (up && past.length > 0) {
                    const at = state === null ? past.length - 1 : state.at - 1;

                    if (at >= 0) {
                        browse.current = { at, draft: state?.draft ?? value };
                        next = past[at];
                    }
                } else if (down && state !== null) {
                    if (state.at + 1 < past.length) {
                        browse.current = { ...state, at: state.at + 1 };
                        next = past[state.at + 1];
                    } else {
                        browse.current = null;
                        next = state.draft;
                    }
                }

                if (next !== undefined) {
                    event.preventDefault();
                    setComposerDraft(sessionId, next);
                    // Put the caret at the end once React has applied the text.
                    requestAnimationFrame(() => {
                        box.setSelectionRange(next.length, next.length);
                    });
                } else if (up || state !== null) {
                    event.preventDefault();
                }
            }
        }
    };

    return { reset, handleKey };
}
