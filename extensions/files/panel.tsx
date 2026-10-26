import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    File as FileIcon,
    Folder as FolderIcon,
    RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { langOfPath } from "@/lib/highlight.ts";
import { CodeBlock } from "@/parts/markdown.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { PanelProps } from "@/sdk/types.ts";

import { type File, type Folder, list, read } from "./refs.ts";

const join = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);
const message = (failure: unknown) =>
    failure instanceof Error ? failure.message : String(failure);

function size(bytes: number): string {
    return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

type Loaded = Record<string, Folder | undefined>;

/** The tree: a folder is read when it is opened, and again by Reload. */
function Tree({ id, onOpen }: { id: number; onOpen: (path: string) => void }) {
    const [folders, setFolders] = useState<Loaded>({});
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set([""]));
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(
        async (path: string) => {
            try {
                const folder = await callAction(list, { path }, id);

                setFolders((all) => ({ ...all, [path]: folder }));
                setError(null);
            } catch (failure) {
                setError(message(failure));
            }
        },
        [id],
    );

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const folder = await callAction(list, { path: "" }, id);

                if (alive) {
                    setFolders((all) => ({ ...all, "": folder }));
                }
            } catch (failure) {
                if (alive) {
                    setError(message(failure));
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, [id]);

    const toggle = (path: string) => {
        const next = new Set(open);

        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);

            if (folders[path] === undefined) {
                void load(path);
            }
        }

        setOpen(next);
    };

    const rows = (dir: string, depth: number): React.ReactNode => {
        const folder = folders[dir];

        if (folder === undefined) {
            return error === null ? (
                <div className="text-faint py-1" style={{ paddingLeft: depth * 12 + 8 }}>
                    …
                </div>
            ) : null;
        }

        return (
            <>
                {folder.entries.map((entry) => {
                    const path = join(dir, entry.name);
                    const expanded = open.has(path);

                    return (
                        <div key={path}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (entry.dir) {
                                        toggle(path);
                                    } else {
                                        onOpen(path);
                                    }
                                }}
                                className="hover:bg-raised text-ink rounded-control flex w-full items-center gap-1.5 py-1 pr-2 text-left"
                                style={{ paddingLeft: depth * 12 + 8 }}
                            >
                                {entry.dir ? (
                                    expanded ? (
                                        <ChevronDown className="text-faint size-3.5 shrink-0" />
                                    ) : (
                                        <ChevronRight className="text-faint size-3.5 shrink-0" />
                                    )
                                ) : (
                                    <span className="size-3.5 shrink-0" />
                                )}
                                {entry.dir ? (
                                    <FolderIcon className="text-info size-3.5 shrink-0" />
                                ) : (
                                    <FileIcon className="text-faint size-3.5 shrink-0" />
                                )}
                                <span className="truncate">{entry.name}</span>
                            </button>
                            {entry.dir && expanded ? rows(path, depth + 1) : null}
                        </div>
                    );
                })}
                {folder.truncated ? (
                    <div className="text-faint py-1" style={{ paddingLeft: depth * 12 + 8 }}>
                        Only the first entries are shown.
                    </div>
                ) : null}
            </>
        );
    };

    return (
        <>
            <div className="border-edge-soft flex items-center justify-between border-b px-3 py-1.5">
                <span className="text-faint text-meta">Session folder</span>
                <button
                    type="button"
                    title="Reload"
                    onClick={() => {
                        setFolders({});
                        setOpen(new Set([""]));
                        void load("");
                    }}
                    className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-6 items-center justify-center"
                >
                    <RotateCw className="size-3.5" />
                </button>
            </div>
            {error === null ? null : <p className="text-danger text-interface p-3">{error}</p>}
            <ScrollArea className="min-h-0 flex-1">
                <div className="text-interface p-1 font-mono">{rows("", 0)}</div>
            </ScrollArea>
        </>
    );
}

function Viewer({ id, path, onBack }: { id: number; path: string; onBack: () => void }) {
    const [file, setFile] = useState<File | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const next = await callAction(read, { path }, id);

                if (alive) {
                    setFile(next);
                }
            } catch (failure) {
                if (alive) {
                    setError(message(failure));
                }
            }
        })();

        return () => {
            alive = false;
        };
    }, [id, path]);

    return (
        <>
            <div className="border-edge-soft flex items-center gap-1 border-b p-2">
                <button
                    type="button"
                    title="Back to the tree"
                    onClick={onBack}
                    className="rounded-control text-muted hover:bg-raised hover:text-ink flex size-7 shrink-0 items-center justify-center"
                >
                    <ArrowLeft className="size-4" />
                </button>
                <span className="text-interface text-ink min-w-0 flex-1 truncate font-mono">
                    {path}
                </span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="p-3">
                    {error !== null ? (
                        <p className="text-danger text-interface">{error}</p>
                    ) : file === undefined ? (
                        <p className="text-faint text-interface">Loading…</p>
                    ) : file.kind === "text" ? (
                        <div className="flex flex-col gap-2">
                            <CodeBlock
                                code={file.text}
                                lang={langOfPath(path)}
                                title={size(file.size)}
                            />
                            {file.truncated ? (
                                <p className="text-faint text-meta">
                                    Only the first 512 KB of {size(file.size)} are shown.
                                </p>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-muted text-interface">
                            {file.kind === "image"
                                ? "An image"
                                : file.kind === "binary"
                                  ? "A binary file"
                                  : "Not a regular file"}{" "}
                            ({size(file.size)}): not shown.
                        </p>
                    )}
                </div>
            </ScrollArea>
        </>
    );
}

export function FilesPanel({ session }: PanelProps) {
    const id = session?.id ?? null;
    const [path, setPath] = useState<string | null>(null);

    if (id === null || session?.cwd === null) {
        return <p className="text-faint text-interface p-3">Open a session to browse its files.</p>;
    }

    return path === null ? (
        <Tree id={id} onOpen={setPath} />
    ) : (
        <Viewer
            key={path}
            id={id}
            path={path}
            onBack={() => {
                setPath(null);
            }}
        />
    );
}
