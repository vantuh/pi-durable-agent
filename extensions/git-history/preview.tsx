import {
    getFiletypeFromFileName,
    hasResolvedThemes,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomCSSVariableTheme,
    type CodeViewItem,
    type FileDiffMetadata,
} from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem, type CodeViewHandle } from "@pierre/diffs/react";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { FileTree } from "./file-tree.tsx";
import { diffStyle, subscribeDiffStyle } from "./preferences.ts";
import type { ChangedFile, Changes } from "./refs.ts";
import type { TreeFile } from "./tree.ts";

const theme = "git-history-roles";
// Reuse the loaded theme across Vite hot reloads.
if (!hasResolvedThemes([theme])) {
    registerCustomCSSVariableTheme(theme, {
        foreground: "var(--role-ink)",
        background: "var(--role-panel)",
        "token-keyword": "var(--role-code-keyword)",
        "token-string": "var(--role-code-string)",
        "token-string-expression": "var(--role-code-string)",
        "token-comment": "var(--role-code-comment)",
        "token-constant": "var(--role-code-constant)",
        "token-parameter": "var(--role-code-parameter)",
        "token-function": "var(--role-code-function)",
        "token-punctuation": "var(--role-code-punctuation)",
        "token-link": "var(--role-info)",
        "token-inserted": "var(--role-ok)",
        "token-deleted": "var(--role-danger)",
        "token-changed": "var(--role-warn)",
    });
}

const options = {
    theme,
    overflow: "scroll",
    hunkSeparators: "metadata",
    stickyHeaders: true,
    // Our own header row is 36px tall: the layout reserves what the header really takes, or every
    // item below it is placed a little too low and a file cannot be scrolled to exactly.
    itemMetrics: { diffHeaderHeight: 36 },
    unsafeCSS: `:host {
        color-scheme: inherit;
        --diffs-font-family: var(--font-mono);
        --diffs-font-size: var(--text-meta);
        --diffs-mixer: var(--role-ink);
        --diffs-fg-number-override: var(--role-muted);
        --diffs-bg-context-override: var(--role-raised);
        --diffs-bg-separator-override: var(--role-raised);
        --diffs-addition-color-override: var(--role-ok);
        --diffs-deletion-color-override: var(--role-danger);
        --diffs-modified-color-override: var(--role-info);
    }`,
} satisfies NonNullable<Parameters<typeof CodeView>[0]["options"]>;

const PARSED_KEPT = 10;
const warmed = new Map<
    string,
    { files?: FileDiffMetadata[]; started: Promise<FileDiffMetadata[]> }
>();

/** What is already parsed, so a shown diff renders in one pass instead of two. */
export function knownPreview(patch: string): FileDiffMetadata[] | undefined {
    return warmed.get(patch)?.files;
}

/**
 * One parse and one highlight pass per patch, whether the diff is about to be shown or only
 * hovered over: the grammars live on after the first, so a later call is nearly free.
 */
export function warmPreview(patch: string): Promise<FileDiffMetadata[]> {
    const found = warmed.get(patch);
    if (found !== undefined) {
        return found.started;
    }
    const entry: { files?: FileDiffMetadata[]; started: Promise<FileDiffMetadata[]> } = {
        started: (async () => {
            const files = parsePatchFiles(patch, undefined, true).flatMap((diff) => diff.files);
            // Pierre's first client render needs its theme and grammars already loaded.
            await preloadHighlighter({
                themes: [theme],
                langs: files.map((file) => getFiletypeFromFileName(file.name)),
            });
            return files;
        })(),
    };
    warmed.set(patch, entry);
    void entry.started.then(
        (files) => {
            entry.files = files;
            return files;
        },
        () => {
            // A failed parse is not a cached answer: the next look reports it again.
            warmed.delete(patch);
            return [];
        },
    );
    const oldest = warmed.keys().next().value;
    if (warmed.size > PARSED_KEPT && oldest !== undefined) {
        warmed.delete(oldest);
    }
    return entry.started;
}

const itemId = (file: FileDiffMetadata, index: number): string => `${String(index)}:${file.name}`;

const countsOf = (file: FileDiffMetadata): { added: number; deleted: number } =>
    file.hunks.reduce(
        (sum, hunk) => ({
            added: sum.added + hunk.additionLines,
            deleted: sum.deleted + hunk.deletionLines,
        }),
        { added: 0, deleted: 0 },
    );

/** A file's title row: it folds the file and stays at the top while the diff scrolls past it. */
function FileHeader({
    path,
    previous,
    counts,
    open,
    onToggle,
}: {
    path: string;
    previous: string | undefined;
    counts: { added: number; deleted: number };
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="bg-panel border-edge-soft text-meta text-muted hover:bg-raised flex h-9 w-full items-center gap-2 border-t px-3 text-left font-mono"
        >
            <ChevronRight
                className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
            />
            <span className="text-ink min-w-0 flex-1 truncate">
                {previous === undefined ? null : <span className="text-faint">{previous} → </span>}
                {path}
            </span>
            {counts.added > 0 || counts.deleted === 0 ? (
                <span className="text-ok shrink-0 tabular-nums">+{counts.added}</span>
            ) : null}
            {counts.deleted > 0 ? (
                <span className="text-danger shrink-0 tabular-nums">−{counts.deleted}</span>
            ) : null}
        </button>
    );
}

/** Files the patch does not carry: binary, or cut off by the preview's size limit. */
function WithoutDiff({ files }: { files: ChangedFile[] }) {
    return (
        <ul>
            {files.map((file) => (
                <li
                    key={file.path}
                    className="border-edge-soft text-meta flex items-center gap-2 border-t px-3 py-2"
                >
                    <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                    {file.binary ? (
                        <span className="text-muted shrink-0">binary</span>
                    ) : (
                        <span className="flex shrink-0 gap-2">
                            <span className="text-ok">+{file.added}</span>
                            <span className="text-danger">−{file.deleted}</span>
                        </span>
                    )}
                    <span className="text-muted shrink-0">no text diff</span>
                </li>
            ))}
        </ul>
    );
}

export function PatchPreview({ data }: { data: Changes }) {
    const style = useSyncExternalStore(subscribeDiffStyle, diffStyle);
    const [parsed, setParsed] = useState<{
        files: FileDiffMetadata[];
        error: string | null;
    } | null>(() => {
        const files = knownPreview(data.patch);
        return files === undefined ? null : { files, error: null };
    });
    const [folded, setFolded] = useState<Record<string, boolean>>({});
    const [versions, setVersions] = useState<Record<string, number>>({});
    const view = useRef<CodeViewHandle<undefined, undefined> | null>(null);
    useEffect(() => {
        let alive = true;
        warmPreview(data.patch).then(
            (files) => {
                if (alive) {
                    setParsed({ files, error: null });
                }
                return undefined;
            },
            (error: unknown) => {
                if (alive) {
                    setParsed({ files: [], error: String(error) });
                }
                return undefined;
            },
        );
        return () => {
            alive = false;
        };
    }, [data.patch]);
    const toggle = useCallback((id: string) => {
        setFolded((old) => ({ ...old, [id]: old[id] !== true }));
        // A folded item only repaints when its version moves, not when the header callback does.
        setVersions((old) => ({ ...old, [id]: (old[id] ?? 0) + 1 }));
    }, []);
    const header = useCallback(
        (item: CodeViewItem<undefined>) =>
            item.type === "diff" ? (
                <FileHeader
                    path={item.fileDiff.name}
                    previous={item.fileDiff.prevName}
                    counts={countsOf(item.fileDiff)}
                    open={folded[item.id] !== true}
                    onToggle={() => {
                        toggle(item.id);
                    }}
                />
            ) : null,
        [folded, toggle],
    );
    const files: TreeFile[] = useMemo(
        () =>
            parsed === null
                ? []
                : parsed.files.map((file, index) => ({
                      id: itemId(file, index),
                      path: file.name,
                      ...countsOf(file),
                  })),
        [parsed],
    );
    const pick = useCallback(
        (file: TreeFile) => {
            if (folded[file.id] === true) {
                toggle(file.id);
            }
            view.current?.scrollTo({
                type: "item",
                id: file.id,
                align: "start",
                behavior: "smooth",
            });
        },
        [folded, toggle],
    );
    if (parsed === null) {
        return <p className="text-muted text-meta px-3 py-2">Rendering diff…</p>;
    }
    if (parsed.error !== null) {
        return (
            <p role="alert" className="text-danger text-meta px-3 py-2">
                Could not render this diff: {parsed.error}
            </p>
        );
    }
    const inPatch = new Set(parsed.files.map((file) => file.name));
    const items: CodeViewDiffItem[] = parsed.files.map((file, index) => {
        const id = itemId(file, index);
        return {
            id,
            type: "diff",
            fileDiff: file,
            collapsed: folded[id] === true,
            version: versions[id] ?? 0,
        };
    });
    return (
        <>
            {/* CodeView renders only the files near the viewport: a 400 KiB commit costs one file. */}
            {items.length === 0 ? null : (
                <div className="flex h-[70vh] min-h-0">
                    {/* The tree is for a pointer and a wide screen; a phone reads the diff alone. */}
                    {items.length < 2 ? null : (
                        <div className="border-edge-soft hidden w-60 shrink-0 border-r md:block">
                            <FileTree files={files} onPick={pick} />
                        </div>
                    )}
                    <CodeView
                        ref={view}
                        items={items}
                        options={{ ...options, diffStyle: style }}
                        renderCustomHeader={header}
                        className="h-full min-h-0 flex-1 overflow-auto"
                    />
                </div>
            )}
            <WithoutDiff files={data.files.filter((file) => !inPatch.has(file.path))} />
        </>
    );
}
