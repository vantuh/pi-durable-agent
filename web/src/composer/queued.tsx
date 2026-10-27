import { Clock, Paperclip, Pencil, X, Zap } from "lucide-react";
import { useState } from "react";

import type { ClientQueued } from "../../../shared/protocol.ts";

/**
 * What a mode means, told on the card itself: the colour, the stripe, and the words the send menu uses.
 * Class names are written in full, so Tailwind sees them.
 */
const MODES: Record<
    ClientQueued["mode"],
    { label: string; hint: string; icon: typeof Zap; stripe: string; tone: string }
> = {
    steer: {
        label: "Steer",
        hint: "after this step",
        icon: Zap,
        stripe: "bg-accent",
        tone: "text-accent",
    },
    followUp: {
        label: "Queued",
        hint: "after the answer",
        icon: Clock,
        stripe: "bg-info",
        tone: "text-info",
    },
};

type Props = {
    items: ClientQueued[];
    /** Take it out of `pi.inbox`: the agent never reads it. */
    onWithdraw: (item: ClientQueued) => void;
    /** Take it out of the queue and put it back in the composer, to be changed and sent again. */
    onEdit: (item: ClientQueued) => void;
};

/** Messages waiting in `pi.inbox`: one card each, with the mode, the text, and the two things one may do to it. */
export function Queued({ items, onWithdraw, onEdit }: Props) {
    // One opened at a time: a long message is read here, then closed again.
    const [open, setOpen] = useState<number | null>(null);

    if (items.length === 0) {
        return null;
    }

    return (
        <ul className="mb-2 flex flex-col gap-1.5">
            {items.map((item) => {
                const mode = MODES[item.mode];
                const Icon = mode.icon;

                return (
                    <li
                        key={item.id}
                        className="rounded-card border-edge bg-raised relative flex items-start gap-1.5 overflow-hidden border py-1.5 pr-1 pl-3"
                    >
                        <span
                            aria-hidden
                            className={`absolute inset-y-0 left-0 w-[3px] ${mode.stripe}`}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="text-meta flex items-center gap-1">
                                <Icon className={`size-3 shrink-0 ${mode.tone}`} />
                                <span className={`font-medium ${mode.tone}`}>{mode.label}</span>
                                <span className="text-faint hidden sm:inline">· {mode.hint}</span>
                            </span>
                            <button
                                type="button"
                                // The queue is a draft waiting for a boundary: reading it is the one thing a tap does.
                                onClick={() => {
                                    setOpen((current) => (current === item.id ? null : item.id));
                                }}
                                className={`text-prose text-ink mt-0.5 text-left break-words whitespace-pre-wrap ${
                                    open === item.id ? "" : "line-clamp-2"
                                }`}
                            >
                                {item.text}
                            </button>
                            {item.files === undefined ? null : (
                                <span className="text-meta text-faint mt-1 flex min-w-0 items-center gap-1">
                                    <Paperclip className="size-3 shrink-0" />
                                    <span className="min-w-0 truncate">
                                        {item.files.map((file) => file.name).join(", ")}
                                    </span>
                                </span>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center">
                            <button
                                type="button"
                                title="Edit and send again"
                                aria-label="Edit and send again"
                                onClick={() => {
                                    onEdit(item);
                                }}
                                className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-7 items-center justify-center"
                            >
                                <Pencil className="size-3.5" />
                            </button>
                            <button
                                type="button"
                                title="Remove from the queue"
                                aria-label="Remove from the queue"
                                onClick={() => {
                                    onWithdraw(item);
                                }}
                                className="rounded-control text-muted hover:bg-raised hover:text-danger flex size-7 items-center justify-center"
                            >
                                <X className="size-4" />
                            </button>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
