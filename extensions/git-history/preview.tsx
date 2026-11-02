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
import {
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";

import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { FileTree } from "./file-tree.tsx";
import { FileMark } from "./icons.tsx";
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

// Matches the row that holds a diff (`duration-200` in web.tsx): a file folds at the speed its commit opens.
const FOLD_MS = 200;
// The library reserves this height for a folded file, and its header is all that is left of it.
const FOLDED_HEIGHT = options.itemMetrics.diffHeaderHeight;

/** A file's box, and the list height that holds every box: both have to move on the same frames. */
interface Fold {
    box: HTMLElement;
    list: HTMLElement;
}

/** The item's own element is the host the library clips the diff into; the list is two levels up. */
function foldOf(header: Element): Fold | undefined {
    const box = header.closest("diffs-container");
    const list = box?.parentElement?.parentElement;
    return box instanceof HTMLElement && list instanceof HTMLElement ? { box, list } : undefined;
}

/**
 * Animates the height the library will settle on, over the inline value it already wrote; the last
 * frame is that value, so the re-render that ends the fold moves nothing.
 */
function animateFold(
    fold: Fold,
    height: { from: number; to: number },
    list: { from: number; to: number },
): [Animation, Animation] {
    const timing: KeyframeAnimationOptions = {
        duration: FOLD_MS,
        easing: "ease-out",
        fill: "forwards",
    };
    const keyframes = (values: { from: number; to: number }): Keyframe[] => [
        { height: `${String(values.from)}px` },
        { height: `${String(values.to)}px` },
    ];
    fold.box.style.overflow = "hidden";
    return [
        fold.box.animate(keyframes(height), timing),
        fold.list.animate(keyframes(list), timing),
    ];
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
    onToggle: (header: HTMLButtonElement) => void;
}) {
    return (
        <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={(event) => {
                onToggle(event.currentTarget);
            }}
            className="bg-panel border-edge-soft hover:text-muted h-9 w-full gap-2 rounded-none border-t px-3 text-left font-mono"
        >
            <ChevronRight
                className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
            />
            <FileMark name={path} />
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
        </Button>
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

/** The page's one scroll while the diff is not drawn yet, or cannot be: the same header, then a note. */
function PendingPane({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 px-3 py-3">{header}</div>
            {children}
        </div>
    );
}

export function PatchPreview({
    data,
    header,
    viewRef,
}: {
    data: Changes;
    header: ReactNode;
    viewRef: RefObject<CodeViewHandle<undefined, undefined> | null>;
}) {
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
    // An item mid-fold is not listening: a second click would animate from a height nobody shows.
    const folding = useRef(new Set<string>());
    // The way to stop the fold a file is in, so a pick in the tree can take that file as it is.
    const settling = useRef(new Map<string, () => void>());
    const toggle = useCallback(
        (id: string, element?: HTMLElement) => {
            const fold = element === undefined ? undefined : foldOf(element);
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const commit = (): void => {
                setFolded((old) => ({ ...old, [id]: old[id] !== true }));
                // A folded item only repaints when its version moves, not when the header callback does.
                setVersions((old) => ({ ...old, [id]: (old[id] ?? 0) + 1 }));
            };
            if (fold === undefined || reduced) {
                commit();
                return;
            }
            if (folding.current.has(id)) {
                return;
            }
            folding.current.add(id);
            let settled = false;
            const list = fold.list.getBoundingClientRect().height;
            // Opening: the library lays the file out at once, from a list that already holds the
            // height it is growing into. Closing: the row folds under its own header first, and the
            // library then drops the diff onto exactly the height already on screen.
            const opening = folded[id] === true;
            if (opening) {
                flushSync(commit);
            }
            const height = fold.box.getBoundingClientRect().height;
            const animations = opening
                ? animateFold(
                      fold,
                      { from: FOLDED_HEIGHT, to: height },
                      { from: list, to: fold.list.getBoundingClientRect().height },
                  )
                : animateFold(
                      fold,
                      { from: height, to: FOLDED_HEIGHT },
                      {
                          from: list,
                          to: list - (height - FOLDED_HEIGHT),
                      },
                  );
            const settle = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                animations.forEach((animation) => {
                    animation.cancel();
                });
                fold.box.style.overflow = "";
                folding.current.delete(id);
                settling.current.delete(id);
            };
            settling.current.set(id, settle);
            const [box] = animations;
            box.onfinish = (): void => {
                if (!opening) {
                    flushSync(commit);
                }
                settle();
            };
            // Cancelling settles too, or a fold stopped midway would keep the item unclickable.
            box.oncancel = settle;
        },
        [folded],
    );
    const fileHeader = useCallback(
        (item: CodeViewItem<undefined>) =>
            item.type === "diff" ? (
                <FileHeader
                    path={item.fileDiff.name}
                    previous={item.fileDiff.prevName}
                    counts={countsOf(item.fileDiff)}
                    open={folded[item.id] !== true}
                    onToggle={(element) => {
                        toggle(item.id, element);
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
            // A pick in the tree is the person's last word on that file: a fold still running would
            // otherwise finish on top of it and fold the diff away just after it was scrolled to.
            const stop = settling.current.get(file.id);
            if (stop !== undefined) {
                stop();
            }
            if (folded[file.id] === true) {
                setFolded((old) => ({ ...old, [file.id]: false }));
                // A folded item only repaints when its version moves, as it does when unfolded.
                setVersions((old) => ({ ...old, [file.id]: (old[file.id] ?? 0) + 1 }));
            }
            requestAnimationFrame(() => {
                viewRef.current?.scrollTo({
                    type: "item",
                    id: file.id,
                    align: "start",
                    behavior: "smooth",
                });
            });
        },
        [folded, viewRef],
    );
    const pageHeader = <div className="flex flex-col gap-3 px-3 py-3">{header}</div>;
    if (parsed === null) {
        return (
            <PendingPane header={header}>
                <p className="text-muted text-meta px-3 py-2">Rendering diff…</p>
            </PendingPane>
        );
    }
    if (parsed.error !== null) {
        return (
            <PendingPane header={header}>
                <Alert className="rounded-none">Could not render this diff: {parsed.error}</Alert>
            </PendingPane>
        );
    }
    const inPatch = new Set(parsed.files.map((file) => file.name));
    const outside = data.files.filter((file) => !inPatch.has(file.path));
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
    if (items.length === 0) {
        return (
            <PendingPane header={header}>
                {outside.length === 0 ? null : <WithoutDiff files={outside} />}
            </PendingPane>
        );
    }
    return (
        <div className="flex min-h-0 flex-1">
            {/* The tree is for a pointer and a wide screen; a phone reads the diff alone. */}
            {items.length < 2 ? null : (
                <div className="border-edge-soft hidden w-60 shrink-0 flex-col border-r md:flex">
                    <FileTree files={files} onPick={pick} />
                </div>
            )}
            <CodeView
                ref={viewRef}
                items={items}
                options={{ ...options, diffStyle: style }}
                renderCustomHeader={fileHeader}
                renderCodeViewHeader={() => pageHeader}
                renderCodeViewFooter={() =>
                    outside.length === 0 ? null : <WithoutDiff files={outside} />
                }
                // The diff is the page's one scroll, so CodeView measures this box as its viewport
                // and mounts only the files and lines near it. Without a bounded height it renders
                // them all; the tree is a column beside it, not another scroller around it.
                className="block min-h-0 min-w-0 flex-1 overflow-y-auto"
            />
        </div>
    );
}
