/** What the sidebar keeps about its folders, on the server so a phone and a computer show the same list. */

/** The hues a folder's icon may take; each is a `tag-*` role in the theme. */
export const FOLDER_COLORS = [
    "red",
    "peach",
    "yellow",
    "green",
    "teal",
    "blue",
    "mauve",
    "pink",
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number];

/** A name shown instead of the folder's own, and a hue for its icon. The folder on disk is never touched. */
export type FolderLook = { name?: string | undefined; color?: FolderColor | undefined };

/** Keyed by the folder's path. A folder missing from `order` shows above the ones in it. */
export type FolderLayout = {
    order: string[];
    collapsed: string[];
    folders: Record<string, FolderLook>;
};

/** Long enough for a project's name, short enough for a sidebar row. */
export const MAX_FOLDER_NAME = 40;
