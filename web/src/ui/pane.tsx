import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The frame every box inside a region wears: a square 1px soft border. The fill is the caller's, because
 * it is the box's own job — a card `bg-panel`, a code surface `bg-sunken` — and so are the room, the
 * position and the animation. The shell regions do not wear it: they touch, so each carries one rule on
 * the side it shares (`border-r` sidebar, `border-l` panel and settings, `border-t` status bar).
 */
export const PANE = "border-edge-soft border";

/**
 * The row at the top of a pane: a title on the left, its actions on the right, a rule under it, 47px
 * tall. The transcript's and a page's headers are another row — `min-h-header` with `py-0.5`, holding a
 * two-line title — so they keep theirs.
 */
export function PaneHeader({ className, ...props }: ComponentProps<"header">) {
    return (
        <header
            data-slot="pane-header"
            className={cn(
                "border-edge-soft flex items-center justify-between border-b px-3 py-2.5",
                className,
            )}
            {...props}
        />
    );
}

/**
 * The row a panel or a page keeps its controls on: one line, a rule under it. The 12px inset the two
 * git-history rows and the notes tabs wear is the default; a viewer's denser row states its own
 * (`gap-1 p-2`), and so does the text size.
 */
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
            data-slot="toolbar"
            className={cn(
                "border-edge-soft flex items-center gap-2 border-b px-3 py-1.5",
                className,
            )}
            {...props}
        />
    );
}
