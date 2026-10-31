/**
 * Code highlighting with shiki, coloured by the theme's roles: shiki's css-variables theme names a token kind
 * (`var(--shiki-token-keyword)`), and `classOf` turns that name into a Tailwind class over a `--role-code-*`. No
 * colour comes from shiki itself. Grammars load on first use, each in its own chunk.
 */

import type { BundledLanguage, Highlighter, ThemedToken, ThemeRegistration } from "shiki";

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

interface Loaded {
    shiki: Highlighter;
    languages: Record<string, unknown>;
    theme: ThemeRegistration;
}

function isBundled(languages: Loaded["languages"], id: string): id is BundledLanguage {
    return Object.hasOwn(languages, id);
}

let loaded: Promise<Loaded> | undefined;

/** shiki is imported here, not at the top: a static import would put its engine in the entry chunk. */
export function load(): Promise<Loaded> {
    loaded ??= (async () => {
        const [{ bundledLanguages, createHighlighter, createJavaScriptRegexEngine }, core] =
            await Promise.all([import("shiki"), import("shiki/core")]);
        const theme = core.createCssVariablesTheme({ name: "roles", fontStyle: true });
        const shiki = await createHighlighter({
            themes: [theme],
            langs: [],
            engine: createJavaScriptRegexEngine(),
        });

        return { shiki, languages: bundledLanguages, theme };
    })();

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

/** Lines of tokens, or undefined for a language shiki does not know: that code stays plain. */
export async function tokensOf(code: string, lang: string): Promise<ThemedToken[][] | undefined> {
    const id = lang.toLowerCase();

    // A block with no language is the common plain case; it must not pull the engine in.
    if (id === "") {
        return undefined;
    }

    const { shiki, languages, theme } = await load();

    if (!isBundled(languages, id)) {
        return undefined;
    }

    if (!shiki.getLoadedLanguages().includes(id)) {
        await shiki.loadLanguage(id);
    }

    return shiki.codeToTokensBase(code, { lang: id, theme });
}

/** A file's language, from its path's extension: shiki knows most by it (`ts`, `py`, `yml`, `sh`). */
export function langOfPath(path: string | undefined): string {
    const name = path?.split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");

    return dot < 1 ? "" : name.slice(dot + 1);
}
