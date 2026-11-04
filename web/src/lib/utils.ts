import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The theme's own names: unknown to tailwind-merge, `text-meta` would be read as a colour and lost
 * beside `text-muted`.
 */
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: ["meta", "code", "ui", "interface", "subheading", "heading"],
            shadow: ["float"],
            spacing: ["stripe", "header"],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
