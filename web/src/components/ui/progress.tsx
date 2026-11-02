import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The fill's colour: the accent for an ordinary meter, a state tone once it is over its own line. */
const TONES = {
    accent: "bg-accent",
    warn: "bg-warn",
    danger: "bg-danger",
};

type ProgressProps = Omit<ComponentProps<typeof ProgressPrimitive.Root>, "value"> & {
    /** How full it is, 0 to `max` (100 by default). */
    value: number;
    tone?: keyof typeof TONES;
};

/**
 * shadcn's progress on the theme's roles: the raised track, and an indicator filled to `value` the way the
 * hand-written meters were, by width. The meter's size (height, width, radius) is the caller's className and
 * its name is the caller's `aria-label`, because every host labels its meter with its own words.
 *
 * The root is a span through `asChild`: most hosts are a button or a span, which take phrasing content only. The
 * indicator is a span for the same reason: it is the root's only child, so a `div` there would sit inside a
 * button.
 */
export function Progress({
    value,
    tone = "accent",
    max = 100,
    className,
    ...props
}: ProgressProps) {
    // Radix reads a value outside 0..max as no value at all, and the meter loses its `aria-valuenow` and
    // draws an empty track. The clamp is here; the number a caller prints stays its own.
    const filled = Math.min(Math.max(value, 0), max);

    return (
        <ProgressPrimitive.Root value={filled} max={max} asChild {...props}>
            <span
                data-slot="progress"
                className={cn("bg-raised flex h-1 overflow-hidden rounded-full", className)}
            >
                <ProgressPrimitive.Indicator asChild>
                    <span
                        data-slot="progress-indicator"
                        className={cn("h-full", TONES[tone])}
                        style={{ width: `${String((filled * 100) / max)}%` }}
                    />
                </ProgressPrimitive.Indicator>
            </span>
        </ProgressPrimitive.Root>
    );
}
