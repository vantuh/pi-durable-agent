import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useSyncExternalStore } from "react";

import { currentDiffLayout, watchDiffLayout } from "@/lib/diff-layout.ts";

import { diffOptions, parsePatch } from "./pierre.ts";
import { useRoom } from "./use-room.ts";

export default function DiffView({ patch, path }: { patch: string; path?: string }) {
    const layout = useSyncExternalStore(watchDiffLayout, currentDiffLayout);
    const [root, room] = useRoom();
    const fileDiff = useMemo(() => {
        const file = parsePatch(patch)[0];
        if (file === undefined) {
            throw new Error("Edit patch contains no file");
        }
        file.name = path ?? "edit";
        return file;
    }, [patch, path]);

    return (
        <div ref={root} className="leading-diff min-w-0">
            <FileDiff
                fileDiff={fileDiff}
                options={{
                    ...diffOptions,
                    disableFileHeader: true,
                    disableErrorHandling: true,
                    diffStyle: layout === "split" && room ? "split" : "unified",
                }}
            />
        </div>
    );
}
