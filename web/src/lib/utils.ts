import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The theme's own names: unknown to tailwind-merge, `text-meta` would be read as a colour and lost
 * beside `text-muted`, and `rounded-control` would lose to a base `rounded-full`.
 */
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: ["meta", "sidebar", "tool", "interface", "prose"],
            radius: ["control", "card"],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
