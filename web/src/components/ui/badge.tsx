import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** One colour set per tone: the muted outline is the default, and the state tones carry their own wash. */
const TONES = {
    muted: "border-edge text-muted",
    raised: "border-edge bg-raised text-ink",
    accent: "border-accent bg-accent text-on-accent",
    info: "border-info/40 bg-info/15 text-info",
    warn: "border-warn/40 bg-warn/15 text-warn",
    danger: "border-danger/40 bg-danger/15 text-danger",
};

type BadgeProps = ComponentProps<"span"> & {
    tone?: keyof typeof TONES;
    /** Hand the looks to the child element, so a link or a button stays one. */
    asChild?: boolean;
};

/** shadcn's badge, reduced to the tones this app uses: a small label that sits beside text. */
export function Badge({ tone = "muted", asChild = false, className, ...props }: BadgeProps) {
    const classes = cn(
        "text-meta inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        TONES[tone],
        className,
    );

    if (asChild) {
        return <Slot.Root data-slot="badge" className={classes} {...props} />;
    }

    return <span data-slot="badge" className={classes} {...props} />;
}
