import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Attachments, type Pending } from "../ui/attachments.tsx";

function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") === true;
}

/**
 * True while files are dragged over the window, and hands them to `onFiles` when they are dropped anywhere.
 * Dragging text or a link does nothing.
 */
export function useWindowDrop(onFiles: (files: File[]) => void): boolean {
    const [dragging, setDragging] = useState(false);
    const latest = useRef(onFiles);

    useEffect(() => {
        latest.current = onFiles;
    });

    useEffect(() => {
        // dragenter and dragleave also fire for every child the pointer crosses: count them.
        let depth = 0;

        const enter = (event: DragEvent): void => {
            if (hasFiles(event)) {
                depth += 1;
                setDragging(true);
            }
        };
        const over = (event: DragEvent): void => {
            if (hasFiles(event)) {
                event.preventDefault();
            }
        };
        const leave = (event: DragEvent): void => {
            if (hasFiles(event)) {
                depth = Math.max(0, depth - 1);
                setDragging(depth > 0);
            }
        };
        const drop = (event: DragEvent): void => {
            if (!hasFiles(event)) {
                return;
            }

            event.preventDefault();
            depth = 0;
            setDragging(false);
            latest.current([...(event.dataTransfer?.files ?? [])]);
        };

        window.addEventListener("dragenter", enter);
        window.addEventListener("dragover", over);
        window.addEventListener("dragleave", leave);
        window.addEventListener("drop", drop);

        return () => {
            window.removeEventListener("dragenter", enter);
            window.removeEventListener("dragover", over);
            window.removeEventListener("dragleave", leave);
            window.removeEventListener("drop", drop);
        };
    }, []);

    return dragging;
}

/** Keys of the files from the last drop, kept until they have uploaded and the card has been seen. */
export function useDropBatch(files: Pending[]): [Pending[], (keys: string[]) => void] {
    const [keys, setKeys] = useState<string[]>([]);
    const batch = files.filter((file) => keys.includes(file.key));
    const busy = batch.some((file) => file.state === "uploading");

    useEffect(() => {
        const timer =
            keys.length === 0 || busy
                ? undefined
                : setTimeout(() => {
                      setKeys([]);
                  }, 900);

        return () => {
            clearTimeout(timer);
        };
    }, [keys, busy]);

    return [batch, setKeys];
}

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
                className={`rounded-card bg-panel flex w-full max-w-sm flex-col items-center gap-3 border-2 p-8 text-center shadow-lg ${
                    dragging ? "border-accent border-dashed" : "border-edge"
                }`}
            >
                <div
                    className={`bg-raised text-accent flex size-12 items-center justify-center rounded-full ${
                        dragging ? "animate-bounce" : ""
                    }`}
                >
                    <Paperclip className="size-5" />
                </div>

                <p className="text-prose text-ink font-medium">
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
