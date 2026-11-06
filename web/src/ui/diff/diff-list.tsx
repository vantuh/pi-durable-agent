import { CodeView } from "@pierre/diffs/react";
import { type ComponentProps, type Ref, useCallback, useSyncExternalStore } from "react";

import { currentDiffLayout, watchDiffLayout } from "@/lib/diff-layout.ts";
import { cn } from "@/lib/utils";

import { diffOptions } from "./pierre.ts";
import { useRoom } from "./use-room.ts";

function setRef(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null): void {
    if (typeof ref === "function") {
        ref(node);
    } else if (ref) {
        ref.current = node;
    }
}

export function DiffList({
    options,
    className,
    containerRef,
    ...props
}: ComponentProps<typeof CodeView<undefined, undefined>>) {
    const layout = useSyncExternalStore(watchDiffLayout, currentDiffLayout);
    const [root, room] = useRoom();
    // Stable, or a ref that owns state (Radix's viewport) would see null and the node on every render.
    const scroller = useCallback(
        (node: HTMLDivElement | null) => {
            setRef(root, node);
            setRef(containerRef, node);
        },
        [root, containerRef],
    );

    return (
        <CodeView
            {...props}
            containerRef={scroller}
            className={cn("leading-diff", className)}
            options={{
                ...diffOptions,
                ...options,
                diffStyle: layout === "split" && room ? "split" : "unified",
            }}
        />
    );
}
