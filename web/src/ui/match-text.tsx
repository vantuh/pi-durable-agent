import { segments } from "@/lib/fuzzy.ts";

/** A search's text with the characters it matched picked out, the way the session list shows them. */
export function MatchText({ text, ranges }: { text: string; ranges: [number, number][] }) {
    return (
        // One span, not a fragment: a flex parent would make each segment its own item, with its gap between them.
        <span>
            {segments(text, ranges).map((part, index) => (
                <span
                    key={`${String(index)}-${part.text}`}
                    className={part.hit ? "bg-warn/30 text-ink" : undefined}
                >
                    {part.text}
                </span>
            ))}
        </span>
    );
}
