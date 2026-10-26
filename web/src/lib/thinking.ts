/** One colour per thinking level, so the composer and the model menu agree. Full class names, so Tailwind sees them. */
const TEXT: Record<string, string> = {
    minimal: "text-think-minimal",
    low: "text-think-low",
    medium: "text-think-medium",
    high: "text-think-high",
    xhigh: "text-think-xhigh",
    max: "text-think-max",
};

export function thinkingText(level: string): string {
    return TEXT[level] ?? "text-faint";
}

/** Same colours for a tab trigger, whose active state would otherwise repaint the text as `ink`. */
const TAB: Record<string, string> = {
    minimal: "text-think-minimal data-[state=active]:text-think-minimal",
    low: "text-think-low data-[state=active]:text-think-low",
    medium: "text-think-medium data-[state=active]:text-think-medium",
    high: "text-think-high data-[state=active]:text-think-high",
    xhigh: "text-think-xhigh data-[state=active]:text-think-xhigh",
    max: "text-think-max data-[state=active]:text-think-max",
};

export function thinkingTab(level: string): string {
    return TAB[level] ?? "text-faint data-[state=active]:text-ink";
}
