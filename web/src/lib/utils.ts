import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The theme's font sizes: unknown to tailwind-merge, `text-meta` would be read as a colour and lost beside `text-muted`. */
const twMerge = extendTailwindMerge({
    extend: { theme: { text: ["meta", "sidebar", "tool", "interface", "prose"] } },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
