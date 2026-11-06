/**
 * Code highlighting with Highlights, coloured by the theme's roles. The CSS-variable palette names a token kind,
 * and `classOf` turns that name into a Tailwind class over a `--role-code-*`. No colour comes from Highlights
 * itself. The engine and its built-in languages load on first use, in one lazy chunk.
 */

import type { Theme, ThemedToken } from "@pierre/highlights";

const CLASSES: Record<string, string> = {
    "var(--role-ink)": "text-ink",
    "var(--role-code-keyword)": "text-code-keyword",
    "var(--role-code-string)": "text-code-string",
    "var(--role-code-comment)": "text-code-comment",
    "var(--role-code-constant)": "text-code-constant",
    "var(--role-code-parameter)": "text-code-parameter",
    "var(--role-code-function)": "text-code-function",
    "var(--role-code-punctuation)": "text-code-punctuation",
    "var(--role-info)": "text-info",
    "var(--role-ok)": "text-ok",
    "var(--role-danger)": "text-danger",
};

type Loaded = Awaited<ReturnType<typeof makeHighlighter>>;

let loaded: Promise<Loaded> | undefined;

/** The CSS-variable palette emits role names, not literal colours or a bundled theme's palette. */
async function makeHighlighter() {
    const { codeToTokens, isSupportedLanguage, tokenNames } = await import("@pierre/highlights");
    const theme: Theme = {
        name: "roles",
        appearance: "dark",
        cssVariables: { prefix: "--role-" },
        style: {
            foreground: "ink",
            background: "panel",
            syntax: {
                ...Object.fromEntries(tokenNames.map((name) => [name.split(".")[0], "ink"])),
                keyword: "code-keyword",
                preproc: "code-keyword",
                string: "code-string",
                comment: { color: "code-comment", font_style: "italic" },
                constant: "code-constant",
                boolean: "code-constant",
                number: "code-constant",
                type: "code-constant",
                "variable.parameter": "code-parameter",
                function: "code-function",
                constructor: "code-function",
                tag: "code-keyword",
                attribute: "code-parameter",
                punctuation: "code-punctuation",
                operator: "code-punctuation",
                link_text: "info",
                link_uri: "info",
                "diff.plus": "ok",
                "diff.minus": "danger",
                emphasis: { color: "ink", font_style: "italic" },
                "emphasis.strong": { color: "ink", font_weight: 700 },
            },
        },
    };

    return { codeToTokens, isSupportedLanguage, theme };
}

/** Highlights is imported here, not at the top: a static import would put its engine in the entry chunk. */
export function load(): Promise<Loaded> {
    loaded ??= makeHighlighter();

    return loaded;
}

/** The token's class: its role colour, and italic or bold as the grammar says. */
export function classOf(token: ThemedToken): string {
    const style = token.fontStyle ?? 0;

    return [
        CLASSES[token.color ?? ""] ?? "text-ink",
        style & 1 ? "italic" : "",
        style & 2 ? "font-semibold" : "",
    ]
        .filter((each) => each !== "")
        .join(" ");
}

/** Lines of tokens, or undefined for a language Highlights does not know: that code stays plain. */
export async function tokensOf(code: string, lang: string): Promise<ThemedToken[][] | undefined> {
    const id = lang.toLowerCase();

    // A block with no language is the common plain case; it must not pull the engine in.
    if (id === "") {
        return undefined;
    }

    const { codeToTokens, isSupportedLanguage, theme } = await load();

    // ANSI interprets escapes and changes the source; code blocks must preserve it verbatim.
    if (id === "ansi" || !isSupportedLanguage(id)) {
        return undefined;
    }

    return codeToTokens(code, { lang: id, theme }).tokens;
}

/** A file's language, from its path's extension: Highlights knows most by it (`ts`, `py`, `yml`, `sh`). */
export function langOfPath(path: string | undefined): string {
    const name = path?.split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");

    return dot < 1 ? "" : name.slice(dot + 1);
}
