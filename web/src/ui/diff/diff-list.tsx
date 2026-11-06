import { CodeView } from "@pierre/diffs/react";
import { type ComponentProps, useSyncExternalStore } from "react";

import { currentDiffLayout, watchDiffLayout } from "@/lib/diff-layout.ts";
import { cn } from "@/lib/utils";

import { diffOptions } from "./pierre.ts";
import { useRoom } from "./use-room.ts";

export function DiffList({
    options,
    className,
    ...props
}: ComponentProps<typeof CodeView<undefined, undefined>>) {
    const layout = useSyncExternalStore(watchDiffLayout, currentDiffLayout);
    const [root, room] = useRoom();

    return (
        <CodeView
            {...props}
            containerRef={root}
            className={cn("leading-diff", className)}
            options={{
                ...diffOptions,
                ...options,
                diffStyle: layout === "split" && room ? "split" : "unified",
            }}
        />
    );
}
