/**
 * The settings, in `dictation.json` of the data directory. Modelled on `extensions/push/store.ts`:
 * a version field, and writes that never overlap, so a reload cannot work from a half-written file.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * Writes to one file run one after another across every store in the process: a reload makes a new
 * store while the old one may still be writing, and both would use the same temporary name.
 */
const WRITES = Symbol.for("pi-durable-agent.dictation.writes");

type Writes = Map<string, Promise<void>>;

function isWrites(value: unknown): value is Writes {
    return value instanceof Map;
}

function writes(): Writes {
    const found: unknown = Reflect.get(globalThis, WRITES);

    if (isWrites(found)) {
        return found;
    }

    const made: Writes = new Map();

    Reflect.set(globalThis, WRITES, made);

    return made;
}

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
    readonly #dir: string;

    constructor(dataDir: string) {
        this.#dir = dataDir;
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
    write(settings: SettingsFields): Promise<void> {
        const all = writes();
        const run = (all.get(this.#file) ?? Promise.resolve()).then(() => this.#save(settings));
        const tail = run.catch(() => undefined);

        all.set(this.#file, tail);
        // Only the last write may remove the entry; a later one has replaced it by then.
        void tail.then(() => {
            if (all.get(this.#file) === tail) {
                all.delete(this.#file);
            }

            return undefined;
        });

        return run;
    }

    async #save(settings: SettingsFields): Promise<void> {
        const temp = `${this.#file}.tmp`;
        const body: DictationFile = { version: 1, ...settings };

        await mkdir(this.#dir, { recursive: true });
        await writeFile(temp, JSON.stringify(body), { mode: 0o600 });
        await rename(temp, this.#file);
    }
}
