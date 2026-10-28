/** What the server and the browser half agree on about the language. Browser-safe: no imports but the contract. */

import { actionRef } from "../../shared/extension-api.ts";

/** `auto` passes no hint at all, and transcribe.cpp detects the language from the audio. */
export const LANGUAGES = ["auto", "en", "uk"] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
    return typeof value === "string" && LANGUAGES.some((one) => one === value);
}

export type LanguageState = { language: Language };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseLanguage(value: unknown): LanguageState {
    const saved = isRecord(value) ? value["language"] : undefined;

    if (!isLanguage(saved)) {
        throw new Error("the server did not answer with a language");
    }

    return { language: saved };
}

/** The language dictation transcribes in; the default is `uk` until the owner changes it. */
export const language = actionRef<undefined, LanguageState>("dictation", "language", parseLanguage);

/** Saves the language; the answer is what the file holds from then on. */
export const setLanguage = actionRef<{ language: Language }, LanguageState>(
    "dictation",
    "setLanguage",
    parseLanguage,
);
