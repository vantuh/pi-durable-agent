import {
    getFiletypeFromFileName,
    hasResolvedThemes,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomCSSVariableTheme,
    type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible.tsx";

import { diffStyle, subscribeDiffStyle, type DiffStyle } from "./preferences.ts";
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
    disableFileHeader: true,
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
} satisfies NonNullable<Parameters<typeof FileDiff>[0]["options"]>;

function FilePreview({
    file,
    diff,
    style,
}: {
    file: ChangedFile;
    diff: FileDiffMetadata | undefined;
    style: DiffStyle;
}) {
    const [open, setOpen] = useState(true);
    const name = diff?.prevName === undefined ? file.path : `${diff.prevName} → ${file.path}`;
    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="border-edge-soft min-w-0 border-t"
        >
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    title={name}
                    className="hover:bg-raised text-meta flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
                >
                    <ChevronDown className={`size-3.5 shrink-0 ${open ? "" : "-rotate-90"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                    {file.binary ? (
                        <span className="text-muted shrink-0">binary</span>
                    ) : (
                        <span className="flex shrink-0 gap-2">
                            <span className="text-ok">+{file.added}</span>
                            <span className="text-danger">−{file.deleted}</span>
                        </span>
                    )}
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0">
                {file.binary ? (
                    <p className="text-muted text-meta px-3 py-2">Binary file: no text diff.</p>
                ) : diff === undefined ? (
                    <p className="text-muted text-meta px-3 py-2">
                        Diff omitted from this preview.
                    </p>
                ) : diff.hunks.length === 0 ? (
                    <p className="text-muted text-meta px-3 py-2">
                        No text changes (rename or file mode only).
                    </p>
                ) : (
                    <FileDiff
                        fileDiff={diff}
                        options={{ ...options, diffStyle: style }}
                        className="block min-w-0"
                    />
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

export function PatchPreview({ data }: { data: Changes }) {
    const style = useSyncExternalStore(subscribeDiffStyle, diffStyle);
    const [parsed, setParsed] = useState<{
        files: Map<string, FileDiffMetadata>;
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
                    setParsed({
                        files: new Map(files.map((file) => [file.name, file])),
                        error: null,
                    });
                }
            } catch (error) {
                if (alive) {
                    setParsed({ files: new Map(), error: String(error) });
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
    return (
        <div className="min-w-0">
            {parsed.error === null ? null : (
                <p role="alert" className="text-danger text-meta px-3 py-2">
                    Could not render this diff: {parsed.error}
                </p>
            )}
            {data.files.map((file) => (
                <FilePreview
                    key={file.path}
                    file={file}
                    diff={parsed.files.get(file.path)}
                    style={style}
                />
            ))}
        </div>
    );
}
