/**
 * A tag's colour as classes. Written out in full, because Tailwind reads class names from the source
 * and a name built from a variable would never be generated.
 */
import type { TagColor } from "./refs.ts";

/** A chip in a session row: the tag's hue on a wash of itself. */
export const TAG_TONE: Record<TagColor, string> = {
    red: "bg-tag-red/15 text-tag-red",
    peach: "bg-tag-peach/15 text-tag-peach",
    yellow: "bg-tag-yellow/15 text-tag-yellow",
    green: "bg-tag-green/15 text-tag-green",
    teal: "bg-tag-teal/15 text-tag-teal",
    blue: "bg-tag-blue/15 text-tag-blue",
    mauve: "bg-tag-mauve/15 text-tag-mauve",
    pink: "bg-tag-pink/15 text-tag-pink",
};

/** The hue itself: a dot in a menu, a swatch in the picker. */
export const TAG_DOT: Record<TagColor, string> = {
    red: "bg-tag-red",
    peach: "bg-tag-peach",
    yellow: "bg-tag-yellow",
    green: "bg-tag-green",
    teal: "bg-tag-teal",
    blue: "bg-tag-blue",
    mauve: "bg-tag-mauve",
    pink: "bg-tag-pink",
};
