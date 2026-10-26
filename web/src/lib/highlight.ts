/**
 * Code highlighting with shiki, coloured by the theme's roles: shiki's css-variables theme names a token kind
 * (`var(--shiki-token-keyword)`), and `classOf` turns that name into a Tailwind class over a `--role-code-*`. No
 * colour comes from shiki itself. Grammars load on first use, each in its own chunk.
 */

import {
    type BundledLanguage,
    bundledLanguages,
    createHighlighter,
    createJavaScriptRegexEngine,
    type Highlighter,
    type ThemedToken,
} from "shiki";
import { createCssVariablesTheme } from "shiki/core";

const THEME = createCssVariablesTheme({ name: "roles", fontStyle: true });

const CLASSES: Record<string, string> = {
    "var(--shiki-foreground)": "text-ink",
    "var(--shiki-token-keyword)": "text-code-keyword",
    "var(--shiki-token-string)": "text-code-string",
    "var(--shiki-token-string-expression)": "text-code-string",
    "var(--shiki-token-comment)": "text-code-comment",
    "var(--shiki-token-constant)": "text-code-constant",
    "var(--shiki-token-parameter)": "text-code-parameter",
    "var(--shiki-token-function)": "text-code-function",
    "var(--shiki-token-punctuation)": "text-code-punctuation",
    "var(--shiki-token-link)": "text-info",
    "var(--shiki-token-inserted)": "text-ok",
    "var(--shiki-token-deleted)": "text-danger",
    "var(--shiki-token-changed)": "text-warn",
};

let highlighter: Promise<Highlighter> | undefined;

function load(): Promise<Highlighter> {
    highlighter ??= createHighlighter({
        themes: [THEME],
        langs: [],
        engine: createJavaScriptRegexEngine(),
    });

    return highlighter;
}

function isBundled(lang: string): lang is BundledLanguage {
    return Object.hasOwn(bundledLanguages, lang);
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

/** Lines of tokens, or undefined for a language shiki does not know: that code stays plain. */
export async function tokensOf(code: string, lang: string): Promise<ThemedToken[][] | undefined> {
    const id = lang.toLowerCase();

    if (!isBundled(id)) {
        return undefined;
    }

    const shiki = await load();

    if (!shiki.getLoadedLanguages().includes(id)) {
        await shiki.loadLanguage(id);
    }

    return shiki.codeToTokensBase(code, { lang: id, theme: THEME });
}

/** A file's language, from its path's extension: shiki knows most by it (`ts`, `py`, `yml`, `sh`). */
export function langOfPath(path: string | undefined): string {
    const name = path?.split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");

    return dot < 1 ? "" : name.slice(dot + 1);
}
