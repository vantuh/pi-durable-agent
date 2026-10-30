import { Quote } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
    /** Takes the words the person picked; they land above the composer. */
    onQuote: (text: string) => void;
};

type Picked = { text: string; left: number; top: number; below: boolean };

const GAP = 8;
/** The button's own width, so it never leaves the window on the right. */
const WIDTH = 88;
/** The height below which there is no room above the selection. */
const TOP = 56;

/** The answer a node sits in, if any: the shape the transcript marks its words with. */
function answerOf(node: Node | null): Element | null {
    const element = node instanceof Element ? node : (node?.parentElement ?? null);

    return element === null ? null : element.closest("[data-quoteable]");
}

/** What a selection holds, when both ends of it lie inside an answer and not anywhere else on the page. */
function selectedText(): string | undefined {
    const selection = document.getSelection();

    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        return undefined;
    }

    if (answerOf(selection.anchorNode) === null || answerOf(selection.focusNode) === null) {
        return undefined;
    }

    const text = selection.toString().trim();

    return text === "" ? undefined : text;
}

/**
 * The Quote button that follows a selection inside an answer: above it, or below when the top of the window has no
 * room. It keeps the selection, so a tap reads the words that were picked.
 */
export function SelectionQuote({ onQuote }: Props) {
    const [picked, setPicked] = useState<Picked | null>(null);

    useEffect(() => {
        const show = (): void => {
            const text = selectedText();
            const selection = document.getSelection();

            if (text === undefined || selection === null) {
                setPicked(null);

                return;
            }

            const box = selection.getRangeAt(0).getBoundingClientRect();

            // Scrolled out of the window: there is nothing left to point at.
            if (box.bottom < 0 || box.top > window.innerHeight) {
                setPicked(null);

                return;
            }

            const below = box.top < TOP;

            setPicked({
                text,
                // Corner to corner: past the right edge of the words, off the end of the line rather than over it.
                left: Math.min(box.right + GAP, window.innerWidth - GAP - WIDTH),
                top: below ? box.bottom + GAP : box.top - GAP,
                below,
            });
        };

        document.addEventListener("selectionchange", show);
        // A scroll moves the words, and the button goes with them; a tap elsewhere clears the selection itself.
        document.addEventListener("scroll", show, true);

        return () => {
            document.removeEventListener("selectionchange", show);
            document.removeEventListener("scroll", show, true);
        };
    }, []);

    if (picked === null) {
        return null;
    }

    return (
        <button
            type="button"
            title="Quote this in the composer"
            // Without this the tap clears the selection before the click can read it.
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            onClick={() => {
                onQuote(picked.text);
                document.getSelection()?.removeAllRanges();
                setPicked(null);
            }}
            style={{
                left: picked.left,
                top: picked.top,
                transform: `translate(0, ${picked.below ? "0" : "-100%"})`,
            }}
            className="rounded-control border-edge bg-panel text-interface text-ink hover:bg-raised focus-visible:ring-accent fixed z-30 flex items-center gap-1.5 border px-2 py-1 shadow-lg focus-visible:ring-2 focus-visible:outline-none"
        >
            <Quote className="text-accent size-3.5" />
            Quote
        </button>
    );
}
