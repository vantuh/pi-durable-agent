import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo, useRef } from "react";

import { treeFiles, type TreeFile } from "./tree.ts";

import "./file-tree.css";

/** Changed files as their folders and names: clicking one scrolls the diff to it. */
export function FileTree({
    files,
    onPick,
}: {
    files: TreeFile[];
    onPick: (file: TreeFile) => void;
}) {
    const byPath = useMemo(() => treeFiles(files), [files]);
    const current = useRef(byPath);
    const { model } = useFileTree({
        paths: [...byPath.keys()],
        initialExpansion: "open",
        icons: "complete",
        renderRowDecoration: ({ item }) => {
            const file = current.current.get(item.path);
            return file === undefined
                ? null
                : {
                      text: "",
                      parts: [
                          {
                              text: file.added > 0 ? `+${String(file.added)}` : "",
                              color: "var(--role-ok)",
                          },
                          {
                              text: file.deleted > 0 ? ` −${String(file.deleted)}` : "",
                              color: "var(--role-danger)",
                          },
                      ],
                  };
        },
    });
    useEffect(() => {
        current.current = byPath;
        model.resetPaths([...byPath.keys()]);
    }, [byPath, model]);

    return (
        <nav aria-label="Changed files" className="bg-panel min-h-0 flex-1 pt-1">
            <PierreFileTree
                model={model}
                className="git-history-tree"
                onClick={(event) => {
                    const row = event.nativeEvent
                        .composedPath()
                        .find(
                            (node) =>
                                node instanceof HTMLElement && node.dataset["itemType"] === "file",
                        );
                    if (row instanceof HTMLElement) {
                        const file = byPath.get(row.dataset["itemPath"] ?? "");
                        if (file !== undefined) {
                            onPick(file);
                        }
                    }
                }}
            />
        </nav>
    );
}
