/**
 * Stands in for `shiki` in the browser build (`vite.config.ts` aliases every `shiki` path here).
 *
 * Diffs' Shiki backend is never selected: every renderer passes `preferredHighlighter: "highlights"`.
 * Left alone, its grammar catalog is 4.6 MB of lazy chunks nothing ever requests. The stubs only
 * exist so the backend chunk still compiles; reaching one throws, because nothing may use Shiki.
 */

/** Every Shiki entry point here is unreachable: the build renders diffs with Highlights. */
function unreachable(): never {
    throw new Error("Shiki is not part of this build: diffs render with Highlights.");
}

export const createHighlighterCore = unreachable;
export const createCssVariablesTheme = unreachable;
export const createOnigurumaEngine = unreachable;
export const createJavaScriptRegexEngine = unreachable;
export const normalizeTheme = unreachable;

/** The two names `shiki/textmate` contributes to a token. */
export const INITIAL = 0;
export const EncodedTokenMetadata = {};

/** `shiki/langs` is read for its keys; an empty catalog keeps that lookup from throwing. */
export const bundledLanguages: Record<string, unknown> = {};
