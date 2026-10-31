import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { treeOf, type TreeBranch, type TreeFile } from "./tree.ts";

const toggleFolded = (folded: Record<string, boolean>, path: string): Record<string, boolean> => ({
    ...folded,
    [path]: folded[path] !== true,
});

/** Changed files as their folders and names: clicking one scrolls the diff to it. */
export function FileTree({
    files,
    onPick,
}: {
    files: TreeFile[];
    onPick: (file: TreeFile) => void;
}) {
    const branches = useMemo(() => treeOf(files), [files]);
    const [folded, setFolded] = useState<Record<string, boolean>>({});
    return (
        <nav aria-label="Changed files" className="text-meta h-full overflow-auto py-1">
            <Rows
                branches={branches}
                depth={0}
                folded={folded}
                onFold={(path) => {
                    setFolded((old) => toggleFolded(old, path));
                }}
                onPick={onPick}
            />
        </nav>
    );
}

function Rows({
    branches,
    depth,
    folded,
    onFold,
    onPick,
}: {
    branches: TreeBranch[];
    depth: number;
    folded: Record<string, boolean>;
    onFold: (path: string) => void;
    onPick: (file: TreeFile) => void;
}) {
    return (
        <ul>
            {branches.map((branch) => {
                const file = branch.file;
                const open = folded[branch.path] !== true;
                return (
                    <li key={branch.path}>
                        {file === undefined ? (
                            <button
                                type="button"
                                aria-expanded={open}
                                onClick={() => {
                                    onFold(branch.path);
                                }}
                                className="text-muted hover:bg-raised flex w-full items-center gap-1 py-0.5 pr-2 text-left"
                                style={{ paddingLeft: `${String(depth * 10 + 6)}px` }}
                            >
                                <ChevronRight
                                    className={cn(
                                        "size-3 shrink-0 transition-transform",
                                        open && "rotate-90",
                                    )}
                                />
                                <span className="truncate">{branch.name}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                title={branch.path}
                                onClick={() => {
                                    onPick(file);
                                }}
                                className="hover:bg-raised flex w-full items-center gap-2 py-0.5 pr-2 text-left"
                                style={{ paddingLeft: `${String(depth * 10 + 6 + 16)}px` }}
                            >
                                <span className="text-ink min-w-0 flex-1 truncate font-mono">
                                    {branch.name}
                                </span>
                                {file.added > 0 ? (
                                    <span className="text-ok shrink-0 tabular-nums">
                                        +{file.added}
                                    </span>
                                ) : null}
                                {file.deleted > 0 ? (
                                    <span className="text-danger shrink-0 tabular-nums">
                                        −{file.deleted}
                                    </span>
                                ) : null}
                            </button>
                        )}
                        {/* A path can be both a folder and a file: the file then keeps its children. */}
                        {open ? (
                            <Rows
                                branches={branch.folders}
                                depth={depth + 1}
                                folded={folded}
                                onFold={onFold}
                                onPick={onPick}
                            />
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
