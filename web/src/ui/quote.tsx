import { Quote, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint } from "@/components/ui/tooltip";

import { PANE } from "./pane.tsx";

type Props = {
    text: string;
    /** The composer takes a quote back; in a message it is what was sent. */
    onRemove?: () => void;
};

/**
 * Words taken from an answer, set apart in grey under a quote mark: above the composer while it is written, and in
 * the message once it is sent. A long one scrolls rather than pushing the box it sits in.
 */
export function QuoteCard({ text, onRemove }: Props) {
    return (
        <div className={`${PANE} bg-panel flex min-w-0 items-start gap-2 py-1.5 pr-1 pl-2`}>
            <Quote aria-hidden className="text-faint mt-0.5 size-3.5 shrink-0" />
            <ScrollArea
                className="min-w-0 flex-1"
                // Room on the right so a long line never ends under the scrollbar's thumb.
                viewportProps={{ className: "text-prose text-muted max-h-[10lh] pr-2" }}
            >
                <p className="break-words whitespace-pre-wrap">{text}</p>
            </ScrollArea>
            {onRemove === undefined ? null : (
                <Hint label="Remove the quote">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove the quote"
                        onClick={onRemove}
                        className="text-faint shrink-0"
                    >
                        <X className="size-3.5" />
                    </Button>
                </Hint>
            )}
        </div>
    );
}
