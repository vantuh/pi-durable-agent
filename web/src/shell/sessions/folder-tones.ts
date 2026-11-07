/** A folder's hue as classes, written out in full because Tailwind reads class names from the source. */
import type { FolderColor } from "../../../../shared/folders.ts";

/** The folder icon. */
export const FOLDER_TEXT: Record<FolderColor, string> = {
    red: "text-tag-red",
    peach: "text-tag-peach",
    yellow: "text-tag-yellow",
    green: "text-tag-green",
    teal: "text-tag-teal",
    blue: "text-tag-blue",
    mauve: "text-tag-mauve",
    pink: "text-tag-pink",
};

/** A swatch in the colour menu. */
export const FOLDER_DOT: Record<FolderColor, string> = {
    red: "bg-tag-red",
    peach: "bg-tag-peach",
    yellow: "bg-tag-yellow",
    green: "bg-tag-green",
    teal: "bg-tag-teal",
    blue: "bg-tag-blue",
    mauve: "bg-tag-mauve",
    pink: "bg-tag-pink",
};
