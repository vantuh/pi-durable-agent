import {
    getFiletypeFromFileName,
    hasResolvedThemes,
    parsePatchFiles,
    preloadHighlighter,
    registerCustomCSSVariableTheme,
    type BaseDiffOptions,
    type FileDiffMetadata,
} from "@pierre/diffs";

const theme = "diff-roles";
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

export const diffOptions = {
    theme,
    overflow: "scroll",
    hunkSeparators: "metadata",
    unsafeCSS: `:host {
        color-scheme: inherit;
        --diffs-font-family: var(--font-mono);
        --diffs-font-size: var(--text-meta);
        --diffs-line-height: var(--leading-diff);
        --diffs-mixer: var(--role-ink);
        --diffs-fg-number-override: var(--role-muted);
        --diffs-bg-context-override: var(--role-raised);
        --diffs-bg-separator-override: var(--role-raised);
        --diffs-addition-color-override: var(--role-ok);
        --diffs-deletion-color-override: var(--role-danger);
        --diffs-modified-color-override: var(--role-info);
    }`,
} satisfies BaseDiffOptions;

export function parsePatch(patch: string): FileDiffMetadata[] {
    return parsePatchFiles(patch, undefined, true).flatMap((diff) => diff.files);
}

export async function prepareDiffs(files: FileDiffMetadata[]): Promise<void> {
    // Pierre's first client render needs its theme and grammars already loaded.
    await preloadHighlighter({
        themes: [theme],
        langs: files.map((file) => file.lang ?? getFiletypeFromFileName(file.name)),
    });
}
