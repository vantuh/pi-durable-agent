import { Paperclip } from "lucide-react";

import { Attachments, type Pending } from "@/ui/attachments.tsx";

/** Full-window cue: "drop here" while dragging, then the files going up until they are in the composer. */
export function DropOverlay({ dragging, batch }: { dragging: boolean; batch: Pending[] }) {
    if (!dragging && batch.length === 0) {
        return null;
    }

    const busy = batch.some((file) => file.state === "uploading");

    return (
        <output
            className={`bg-canvas/70 animate-drop-in fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm ${
                dragging ? "" : "pointer-events-none"
            }`}
        >
            <div
                className={`bg-panel flex w-full max-w-sm flex-col items-center gap-3 border-2 p-8 text-center ${
                    dragging ? "border-accent border-dashed" : "border-edge"
                }`}
            >
                <div
                    className={`bg-raised text-accent flex size-12 items-center justify-center ${
                        dragging ? "animate-bounce" : ""
                    }`}
                >
                    <Paperclip className="size-5" />
                </div>

                <p className="text-interface text-ink font-medium">
                    {dragging ? "Drop to attach" : busy ? "Attaching…" : "Attached"}
                </p>

                {dragging ? (
                    <p className="text-meta text-faint">The files join this conversation</p>
                ) : (
                    <Attachments files={batch} />
                )}
            </div>
        </output>
    );
}
