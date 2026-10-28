/**
 * What the server and the browser half agree on about the settings. Browser-safe: no imports but
 * the contract.
 */

import { actionRef } from "../../shared/extension-api.ts";

/** `auto` passes no hint at all, and transcribe.cpp detects the language from the audio. */
export const LANGUAGES = ["auto", "en", "uk"] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
    return typeof value === "string" && LANGUAGES.some((one) => one === value);
}

/** The idle time is minutes: 0 lets the model go as soon as the dictation that needed it ends. */
export const MIN_IDLE_MINUTES = 0;
export const MAX_IDLE_MINUTES = 1440;
export const DEFAULT_IDLE_MINUTES = 10;

/**
 * The three fields the browser sends and `dictation.json` holds. Each check throws a sentence that
 * names its field, so a refusal reads the same whether the file or the browser was wrong.
 */
export type SettingsFields = { language: Language; model: string | null; idleMinutes: number };

export function checkLanguage(value: unknown): Language {
    if (!isLanguage(value)) {
        throw new Error("the language must be auto, en or uk");
    }

    return value;
}

/** Null means the first Handy whisper GGUF found; anything else must be a `.gguf` path. */
export function checkModel(value: unknown): string | null {
    if (value === null) {
        return null;
    }

    if (typeof value === "string" && value.trim() !== "" && value.endsWith(".gguf")) {
        return value;
    }

    throw new Error("the model must be a .gguf path or null");
}

export function checkIdleMinutes(value: unknown): number {
    if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= MIN_IDLE_MINUTES &&
        value <= MAX_IDLE_MINUTES
    ) {
        return value;
    }

    throw new Error(
        `the idle time must be ${String(MIN_IDLE_MINUTES)} to ${String(MAX_IDLE_MINUTES)} minutes`,
    );
}

/** One GGUF the model dropdown offers, with its file name and its size in whole megabytes. */
export type ModelChoice = { path: string; name: string; megabytes: number };

export type Settings = SettingsFields & { models: ModelChoice[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function modelOf(value: unknown): ModelChoice {
    const path = isRecord(value) ? value["path"] : undefined;
    const name = isRecord(value) ? value["name"] : undefined;
    const megabytes = isRecord(value) ? value["megabytes"] : undefined;

    if (
        typeof path !== "string" ||
        typeof name !== "string" ||
        typeof megabytes !== "number" ||
        !Number.isFinite(megabytes)
    ) {
        throw new Error("the server did not answer with a model");
    }

    return { path, name, megabytes };
}

function parseSettings(value: unknown): Settings {
    const models = isRecord(value) ? value["models"] : undefined;

    if (!isRecord(value) || !Array.isArray(models)) {
        throw new Error("the server did not answer with settings");
    }

    return {
        language: checkLanguage(value["language"]),
        model: checkModel(value["model"]),
        idleMinutes: checkIdleMinutes(value["idleMinutes"]),
        models: models.map((one: unknown) => modelOf(one)),
    };
}

/** The three settings and the models the dropdown may offer; `uk` and ten minutes until chosen. */
export const settings = actionRef<undefined, Settings>("dictation", "settings", parseSettings);

/** Saves all three; the answer is what the file holds from then on, with a fresh list of models. */
export const saveSettings = actionRef<SettingsFields, Settings>(
    "dictation",
    "saveSettings",
    parseSettings,
);
