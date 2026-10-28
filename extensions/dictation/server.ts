/**
 * Local dictation: the browser records the microphone and this server transcribes it with
 * transcribe.cpp on this machine, so no audio goes to a speech service.
 *
 * Ported from Pi Pocket's `local-dictation/server.ts` (MIT), rewritten for this core's seams: the
 * routes are raw HTTP, the settings are a file, and the model goes with the extension.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { defineExtension } from "@earendil-works/pi-durable";
import type { TranscribeModel } from "transcribe-cpp";

import { ActionError, type Action, type Host, type HttpHandler } from "../../server/sdk.ts";
import { answer, answerError, HttpError, readJson, record } from "./http.ts";
import { Parts, toSamples } from "./parts.ts";
import {
    checkIdleMinutes,
    checkLanguage,
    checkModel,
    DEFAULT_IDLE_MINUTES,
    type ModelChoice,
    type Settings,
    type SettingsFields,
} from "./refs.ts";
import { DictationStore } from "./store.ts";

export const meta = {
    title: "Dictation",
    description: "A mic beside Send that records here and is transcribed on this machine.",
};

/** What the browser sends and the model takes: 16 kHz mono 16-bit PCM. */
const RATE = 16_000;

/** The recording id the browser makes: `crypto.randomUUID()`, checked here because the body is unchecked JSON. */
const ID = /^[A-Za-z0-9-]{8,64}$/;

/** A take nobody sends back holds the model no longer than this, even with an idle time of 0. */
const TAKEN_MS = 5 * 60_000;

/** Where Handy keeps the whisper GGUFs it downloaded; a test points this somewhere of its own. */
const HUB = join(homedir(), ".cache", "huggingface", "hub");

/** The names in a folder, or none when it is not there: a machine without Handy has no models. */
function names(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

/**
 * Every whisper GGUF that Handy downloaded, most wanted first: the Q8_0 large-v3-turbo, the rest of
 * the turbo family, then everything else. The first one is the model `null` in the settings means.
 */
export function candidates(hub: string = HUB): string[] {
    const found: string[] = [];

    for (const repo of names(hub).filter((name) =>
        name.startsWith("models--handy-computer--whisper-"),
    )) {
        const snapshots = join(hub, repo, "snapshots");

        for (const revision of names(snapshots)) {
            const dir = join(snapshots, revision);

            for (const file of names(dir)) {
                if (file.endsWith(".gguf")) {
                    found.push(join(dir, file));
                }
            }
        }
    }

    const turbo = found.filter((path) => path.includes("large-v3-turbo"));
    const best = turbo.find((path) => path.includes("Q8_0"));

    return [
        ...(best === undefined ? [] : [best]),
        ...turbo.filter((path) => path !== best),
        ...found.filter((path) => !path.includes("large-v3-turbo")),
    ];
}

/** What the model dropdown lists: each candidate with its file name and size, in whole megabytes. */
export function models(hub: string = HUB): ModelChoice[] {
    const choices: ModelChoice[] = [];

    for (const path of candidates(hub)) {
        try {
            const { size } = statSync(path);

            choices.push({
                path,
                name: basename(path),
                megabytes: Math.round(size / (1024 * 1024)),
            });
        } catch {
            // A file that went between the listing and the stat is not offered.
        }
    }

    return choices;
}

/** The settings and the models to choose from: what both actions answer. */
function settingsAnswer(settings: SettingsFields): Settings {
    const { language, model, idleMinutes } = settings;

    return { language, model, idleMinutes, models: models() };
}

/** One installed version's dictation: the model once warm, and the parts of recordings in flight. */
export class Dictation {
    readonly parts = new Parts();
    readonly #store: DictationStore;
    #loading: Promise<TranscribeModel> | null = null;
    #idle: NodeJS.Timeout | undefined;
    // From the settings the last load read: the model holds ~900 MB with Metal, so it goes when they say.
    #idleMs = DEFAULT_IDLE_MINUTES * 60_000;
    #gone = false;

    constructor(dataDir: string) {
        this.#store = new DictationStore(dataDir);
    }

    /** Loads the model for a recording that is about to start, so it is ready when the person stops. */
    async warm(): Promise<void> {
        try {
            await this.#model();
        } catch (failure) {
            throw this.#failed(failure);
        }

        // With an idle time of 0 the model goes when the dictation ends, not before it starts; a take
        // that nobody finishes still cannot hold it past this.
        this.#rest(this.#idleMs === 0 ? TAKEN_MS : this.#idleMs);
    }

    /** One whole recording as text, said in the language the setting names. */
    async text(pcm: Buffer): Promise<string> {
        if (pcm.length < RATE / 2) {
            throw new HttpError(400, "Too short to transcribe.");
        }

        const said = (await this.#store.read()).language;

        let loaded: TranscribeModel;

        try {
            loaded = await this.#model();
        } catch (failure) {
            throw this.#failed(failure);
        }

        try {
            // `auto` passes no language at all: transcribe.cpp detects it, and reports it as `result.language`.
            const result = await loaded.transcribe(
                toSamples(pcm),
                said === "auto" ? {} : { language: said },
            );

            return result.text.trim();
        } catch (failure) {
            throw new HttpError(
                500,
                `Transcription failed: ${failure instanceof Error ? failure.message : String(failure)}`,
            );
        } finally {
            this.#rest();
        }
    }

    /** Disposal waits behind the model's own lock, so a transcription that still runs finishes first. */
    dispose(): void {
        this.#gone = true;
        this.parts.clear();
        this.#unload();
    }

    // Loaded at the first use, not with the module: a reload then never holds two models at once.
    #model(): Promise<TranscribeModel> {
        clearTimeout(this.#idle);

        const current = this.#loading;

        if (current !== null) {
            return current;
        }

        const started = (async () => {
            const saved = await this.#store.read();
            const path = saved.model ?? candidates()[0];

            if (path === undefined) {
                throw new Error(
                    "No Handy whisper GGUF under ~/.cache/huggingface/hub. Choose a model in the Dictation settings.",
                );
            }

            if (!existsSync(path)) {
                throw new Error(`The chosen model is not at ${path}.`);
            }

            const { TranscribeModel } = await import("transcribe-cpp");
            const loaded = await TranscribeModel.load(path);

            if (this.#gone) {
                loaded.dispose();

                throw new Error("Local dictation was turned off.");
            }

            // The idle time read with the model is the one this model keeps, until the next load.
            this.#idleMs = saved.idleMinutes * 60_000;

            return loaded;
        })();

        this.#loading = started;
        // A failed load is tried again at the next dictation.
        void started.catch(() => {
            if (this.#loading === started) {
                this.#loading = null;
            }
        });

        return started;
    }

    #unload(): void {
        const current = this.#loading;

        clearTimeout(this.#idle);
        this.#loading = null;
        void this.#release(current);
    }

    async #release(current: Promise<TranscribeModel> | null): Promise<void> {
        if (current === null) {
            return;
        }

        try {
            (await current).dispose();
        } catch {
            // A load that failed holds nothing to let go.
        }
    }

    #rest(afterMs: number = this.#idleMs): void {
        clearTimeout(this.#idle);

        if (afterMs === 0) {
            // Zero minutes: the model goes as soon as the dictation that needed it ends.
            this.#unload();

            return;
        }

        this.#idle = setTimeout(() => {
            this.#unload();
        }, afterMs);
        this.#idle.unref();
    }

    #failed(failure: unknown): HttpError {
        return new HttpError(
            503,
            `The dictation model did not load: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
    }
}

const instances = new WeakMap<Host, Dictation>();

export default function dictation(host: Host) {
    const local = new Dictation(host.dataDir);

    instances.set(host, local);
    host.onDispose(() => {
        local.dispose();
    });

    return defineExtension({ name: host.name });
}

/** The version installed for this host: the routes and the actions found it in `dictation()`. */
function manager(host: Host): Dictation {
    const found = instances.get(host);

    if (found === undefined) {
        throw new Error("Dictation has not been installed.");
    }

    return found;
}

function idOf(value: unknown): string {
    const id = typeof value === "string" ? value : "";

    if (!ID.test(id)) {
        throw new HttpError(400, "Bad recording id.");
    }

    return id;
}

function partOf(value: unknown): Buffer {
    const pcm = Buffer.from(typeof value === "string" ? value : "", "base64");

    if (pcm.length === 0) {
        throw new HttpError(400, "An audio part was empty.");
    }

    return pcm;
}

/** The route name in `/api/extensions/dictation/http/name?query`, or "". */
function routeOf(path: string): string {
    const question = path.indexOf("?");
    const only = question === -1 ? path : path.slice(0, question);

    return only.replace(/^\/+|\/+$/g, "");
}

/** The routes, under `/api/extensions/dictation/http/`: the browser calls them with a JSON body. */
export const http =
    (host: Host): HttpHandler =>
    async ({ request, response, path }) => {
        try {
            const body = record(await readJson(request)) ?? {};

            answer(response, 200, await handle(manager(host), routeOf(path), body));
        } catch (error) {
            answerError(response, error);
        }
    };

async function handle(
    local: Dictation,
    route: string,
    body: Record<string, unknown>,
): Promise<unknown> {
    switch (route) {
        case "warm":
            await local.warm();

            return { ok: true };

        case "audio": {
            const seq = Number(body["seq"]);

            if (!Number.isInteger(seq) || seq < 0) {
                throw new HttpError(400, "Bad part number.");
            }

            return {
                bytes: local.parts.add(idOf(body["id"]), seq, partOf(body["pcm"]), Date.now()),
            };
        }

        case "transcribe": {
            const pcm = local.parts.take(idOf(body["id"]));

            if (pcm === undefined) {
                throw new HttpError(400, "That recording is gone. Send it again.");
            }

            return { text: await local.text(pcm) };
        }

        default:
            throw new HttpError(404, `No dictation route "${route}".`);
    }
}

export const actions = (host: Host): Record<string, Action> => {
    const store = new DictationStore(host.dataDir);

    return {
        async settings() {
            return settingsAnswer(await store.read());
        },

        async saveSettings({ args }) {
            const wanted = checkedSettings(args);

            await store.write(wanted);

            return settingsAnswer(wanted);
        },
    };
};

/** The arguments of one field of the unchecked body. */
function field(args: unknown, name: string): unknown {
    return typeof args === "object" && args !== null ? Reflect.get(args, name) : undefined;
}

/** All three fields by the rules the file is read with; a bad one names itself in the refusal. */
function checkedSettings(args: unknown): SettingsFields {
    try {
        return {
            language: checkLanguage(field(args, "language")),
            model: checkModel(field(args, "model")),
            idleMinutes: checkIdleMinutes(field(args, "idleMinutes")),
        };
    } catch (failure) {
        throw new ActionError(
            failure instanceof Error ? failure.message : "the dictation settings are malformed",
        );
    }
}
