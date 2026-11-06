import { useEffect, useEffectEvent, useState } from "react";

function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") === true;
}

/**
 * True while files are dragged over the window, and hands them to `onFiles` when they are dropped anywhere.
 * Dragging text or a link does nothing.
 */
export function useWindowDrop(onFiles: (files: File[]) => void): boolean {
    const [dragging, setDragging] = useState(false);
    const dropped = useEffectEvent(onFiles);

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
            dropped([...(event.dataTransfer?.files ?? [])]);
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
