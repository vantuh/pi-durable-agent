import {
    getFiletypeFromFileName,
    hasResolvedThemes,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomCSSVariableTheme,
    type FileDiffMetadata,
} from "@pierre/diffs";
import { CodeView, type CodeViewDiffItem } from "@pierre/diffs/react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { diffStyle, subscribeDiffStyle } from "./preferences.ts";
import type { ChangedFile, Changes } from "./refs.ts";

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
    } | null>(null);
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const files = parsePatchFiles(data.patch, undefined, true).flatMap(
                    (patch) => patch.files,
                );
                // Pierre's first client render needs its theme and grammars already loaded.
                await preloadHighlighter({
                    themes: [theme],
                    langs: files.map((file) => getFiletypeFromFileName(file.name)),
                });
                if (alive) {
                    setParsed({ files, error: null });
                }
            } catch (error) {
                if (alive) {
                    setParsed({ files: [], error: String(error) });
                }
            }
        })();
        return () => {
            alive = false;
        };
    }, [data.patch]);
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
    const items: CodeViewDiffItem[] = parsed.files.map((file, index) => ({
        id: `${String(index)}:${file.name}`,
        type: "diff",
        fileDiff: file,
    }));
    return (
        <>
            {/* CodeView renders only the files near the viewport: a 400 KiB commit costs one file. */}
            {items.length === 0 ? null : (
                <CodeView
                    items={items}
                    options={{ ...options, diffStyle: style }}
                    className="h-[70vh] min-h-0 overflow-auto"
                />
            )}
            <WithoutDiff files={data.files.filter((file) => !inPatch.has(file.path))} />
        </>
    );
}
