/**
 * A tag's colour as classes. Written out in full, because Tailwind reads class names from the source
 * and a name built from a variable would never be generated.
 */
import type { TagColor } from "./refs.ts";

/** A chip in a session row: the tag's hue as text, no wash under it, so a row of tags stays quiet. */
export const TAG_TONE: Record<TagColor, string> = {
    red: "text-tag-red",
    peach: "text-tag-peach",
    yellow: "text-tag-yellow",
    green: "text-tag-green",
    teal: "text-tag-teal",
    blue: "text-tag-blue",
    mauve: "text-tag-mauve",
    pink: "text-tag-pink",
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
