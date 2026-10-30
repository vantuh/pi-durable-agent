/**
 * The settings, in `dictation.json` of the data directory. Modelled on `extensions/push/store.ts`:
 * a version field, and writes that never overlap, so a reload cannot work from a half-written file.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeJsonFile } from "../../server/sdk.ts";
import {
    checkIdleMinutes,
    checkLanguage,
    checkModel,
    DEFAULT_IDLE_MINUTES,
    type SettingsFields,
} from "./refs.ts";

export type DictationFile = { version: 1 } & SettingsFields;

/** What dictation uses until the owner chooses in Settings: `uk` is how they dictate. */
const DEFAULTS: SettingsFields = { language: "uk", model: null, idleMinutes: DEFAULT_IDLE_MINUTES };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseFile(text: string): DictationFile {
    const raw: unknown = JSON.parse(text);

    if (!isRecord(raw) || raw["version"] !== 1) {
        throw new Error("dictation.json has an unknown shape");
    }

    try {
        return {
            version: 1,
            language: checkLanguage(raw["language"]),
            // A file written before the model and the idle time became settings takes the defaults.
            model: raw["model"] === undefined ? DEFAULTS.model : checkModel(raw["model"]),
            idleMinutes:
                raw["idleMinutes"] === undefined
                    ? DEFAULTS.idleMinutes
                    : checkIdleMinutes(raw["idleMinutes"]),
        };
    } catch (error) {
        throw new Error("dictation.json has an unknown shape", { cause: error });
    }
}

export class DictationStore {
    readonly #file: string;

    constructor(dataDir: string) {
        this.#file = join(dataDir, "dictation.json");
    }

    async read(): Promise<DictationFile> {
        let text: string;

        try {
            text = await readFile(this.#file, "utf8");
        } catch (error) {
            if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") {
                return { version: 1, ...DEFAULTS };
            }

            throw new Error("dictation.json cannot be read", { cause: error });
        }

        return parseFile(text);
    }

    /** Saves all three fields: a file this store cannot read is never replaced. */
    async write(settings: SettingsFields): Promise<void> {
        const body: DictationFile = { version: 1, ...settings };

        await writeJsonFile(this.#file, body, { mode: 0o600 });
    }
}
