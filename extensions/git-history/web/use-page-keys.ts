import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useEffect } from "react";

import type { PageProps } from "@/sdk/types.ts";

import { heldBy, nextRow, pageStep } from "./keys.ts";
import type { Place } from "./place.ts";

/** An arrow press moves what an ordinary scroll box moves for one: a couple of lines of the diff. */
const SCROLL_STEP = 40;

/** The page's keys, listened for on the window. */
export function usePageKeys({
    where,
    root,
    targets,
    rows,
    view,
    back,
    close,
}: {
    where: Place["kind"];
    root: RefObject<HTMLDivElement | null>;
    targets: string[];
    rows: RefObject<Map<string, HTMLButtonElement>>;
    view: RefObject<CodeViewHandle<undefined, undefined> | null>;
    back: PageProps["back"];
    close: PageProps["close"];
}): void {
    // The page owns its keys: the list's cursor, the detail's scroll, and Escape out of either. The page is
    // reached from the header, whose button keeps the focus, so the listener is the window's; a key pressed
    // in the page or on nothing at all is its, and a field, a dialog, a form, a terminal and an input method
    // keep what they are typing.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const origin = event.target instanceof Element ? event.target : null;
            // The frame's own Back and Close belong to this page; the sidebar's controls do not.
            const host = root.current?.closest('[data-slot="page-host"]') ?? null;

            if (origin !== document.body && host?.contains(origin) !== true) {
                return;
            }

            const step = pageStep({
                where,
                key: event.key,
                modified: event.ctrlKey || event.altKey || event.metaKey || event.shiftKey,
                held: heldBy(origin),
                composing: event.isComposing,
                taken: event.defaultPrevented,
            });

            if (step.kind === "none") {
                return;
            }

            // The arrows are the page's here: the browser must not scroll what it would have scrolled.
            event.preventDefault();

            if (step.kind === "close") {
                close("composer");
            } else if (step.kind === "back") {
                // The frame's own back arrow, key for key: a review leads to the commit under it.
                back();
            } else if (step.kind === "move") {
                const drawn = targets
                    .map((hash) => rows.current.get(hash))
                    .filter((element) => element !== undefined);
                nextRow(drawn, document.activeElement, step.by)?.focus();
            } else {
                // The diff's own scroller moves, as it does for a wheel: the element clamps at either end.
                view.current
                    ?.getInstance()
                    ?.getContainerElement()
                    ?.scrollBy({ top: step.by * SCROLL_STEP, behavior: "instant" });
            }
        };

        window.addEventListener("keydown", onKey);

        return () => {
            window.removeEventListener("keydown", onKey);
        };
    });
}
