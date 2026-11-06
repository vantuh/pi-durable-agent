/** Hides everything but the status marks and the toggle once the sidebar is a narrow rail. */
export const FADE =
    "transition-opacity lg:group-data-[collapsed]/side:opacity-0 lg:group-data-[collapsed]/side:pointer-events-none";
/** Gives back the height of blocks that are invisible in the rail; overflow is clipped only then, so the folder menu can still open. */
export const FOLD =
    "max-h-24 transition-[max-height,padding,border-width] lg:group-data-[collapsed]/side:max-h-0 lg:group-data-[collapsed]/side:overflow-hidden lg:group-data-[collapsed]/side:border-b-0 lg:group-data-[collapsed]/side:py-0 lg:group-data-[collapsed]/side:pt-0";
