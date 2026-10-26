/**
 * The extension seam. One folder in `extensions/` is one extension, its name is the folder's name, and
 * a folder that fails to load keeps whatever it installed last time. Everything the app can do beyond
 * the core is a folder here.
 */

import { type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { EntryRecord, Extension, Registry } from "@earendil-works/pi-durable";

import type { ClientStatus } from "../shared/protocol.ts";

/** What an extension's `server.ts` receives. It grows only when a feature needs more. */
export type Host = {
    readonly name: string;
    readonly cwd: string;
    readonly dataDir: string;
    readonly log: (message: string) => void;
    /**
     * Registers cleanup for what this version holds (timers, subscriptions). It runs once, after a
     * newer version replaced this one, when the folder goes, or when the server stops.
     */
    readonly onDispose: (dispose: Disposer) => void;
};

export type Disposer = () => void | Promise<void>;

export type ServerModule = (
    host: Host,
) => Extension | undefined | void | Promise<Extension | undefined | void>;

/** What a status provider reads: the conversation's active entries. */
export type StatusView = {
    readonly entries: readonly EntryRecord[];
    /** The context window of a model in the catalog, in tokens. */
    readonly contextWindow: (provider: string, modelId: string) => number | undefined;
};

/**
 * A folder's optional named export `status`. It runs on every commit and returns one field for the
 * status bar (slot `end` unless it names one), or nothing when it has no honest number to show.
 */
export type StatusLine = Omit<ClientStatus, "source" | "slot"> & { slot?: ClientStatus["slot"] };

export type StatusProvider = (view: StatusView) => StatusLine | undefined;

export type LoadFailure = { folder: string; reason: string };

/** Installed by the core, so no folder may take the name. */
const RESERVED = new Set(["coding-tools"]);

/** How long a burst of saves is collected before loading again. */
const SETTLE_MS = 150;

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isExtension(value: unknown): value is Extension {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const name: unknown = Reflect.get(value, "name");

    return typeof name === "string" && name !== "";
}

export class Extensions {
    readonly #registry: Registry;
    readonly #dir: string;
    readonly #cwd: string;
    readonly #dataDir: string;
    readonly #log: (message: string) => void;
    readonly #installed = new Map<string, Extension>();
    readonly #status = new Map<string, StatusProvider>();
    readonly #listeners = new Set<() => void>();
    /** Per folder, the disposers of the version that is live now. */
    readonly #disposers = new Map<string, Disposer[]>();

    #watcher: FSWatcher | undefined;
    #generation = 0;
    #failed: LoadFailure[] = [];
    #queue: Promise<void> = Promise.resolve();
    #timer: NodeJS.Timeout | undefined;

    constructor(options: {
        registry: Registry;
        dir: string;
        cwd: string;
        dataDir: string;
        log: (message: string) => void;
    }) {
        this.#registry = options.registry;
        this.#dir = options.dir;
        this.#cwd = options.cwd;
        this.#dataDir = options.dataDir;
        this.#log = options.log;
    }

    /** The folders installed now, sorted. */
    get names(): string[] {
        return [...this.#installed.keys()].sort();
    }

    /** Folders that failed to load, and why. The extension they had before is still installed. */
    get failed(): readonly LoadFailure[] {
        return this.#failed;
    }

    /** The status fields of every installed folder that has a provider, in folder order. */
    statuses(view: StatusView): ClientStatus[] {
        const fields: ClientStatus[] = [];

        for (const folder of [...this.#status.keys()].sort()) {
            try {
                const field = this.#status.get(folder)?.(view);

                if (field !== undefined) {
                    fields.push({ source: folder, slot: "end", ...field });
                }
            } catch {
                // A provider that throws shows nothing; it must not stop a commit from being published.
            }
        }

        return fields;
    }

    /** Calls `listener` after every load, so the page can drop a field whose folder went away. */
    onChange(listener: () => void): void {
        this.#listeners.add(listener);
    }

    /** Loads every folder. A load already running is finished first, so two saves never interleave. */
    load(): Promise<void> {
        const run = this.#queue.then(() => this.#load());

        // The caller gets its own rejection; the queue itself must stay usable for later loads.
        this.#queue = run.catch(() => undefined);

        return run;
    }

    /** Loads again whenever anything under `extensions/` changes. */
    watch(): void {
        this.#watcher = watch(this.#dir, { recursive: true }, () => {
            if (this.#timer !== undefined) {
                clearTimeout(this.#timer);
            }

            this.#timer = setTimeout(() => {
                this.#timer = undefined;
                void this.load().catch((error: unknown) => {
                    this.#log(`extensions: ${reasonOf(error)}`);
                });
            }, SETTLE_MS);
        });
    }

    /** Stops watching, finishes a running load, and runs every disposer. Safe to call twice. */
    async dispose(): Promise<void> {
        this.#watcher?.close();
        this.#watcher = undefined;

        if (this.#timer !== undefined) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }

        await this.#queue;

        for (const folder of [...this.#disposers.keys()]) {
            await this.#release(folder);
        }
    }

    async #load(): Promise<void> {
        this.#generation += 1;

        const present = new Set<string>();
        const failed: LoadFailure[] = [];

        for (const folder of await this.#folders()) {
            present.add(folder);

            const attempt: Disposer[] = [];

            try {
                const extension = await this.#build(folder, attempt);

                if (extension === undefined) {
                    // The module ran, so what it registered is live: it replaces the old version's.
                    this.#drop(folder, "installs nothing");
                } else {
                    this.#registry.install(extension);
                    this.#installed.set(folder, extension);
                }

                await this.#swap(folder, attempt);
            } catch (error) {
                failed.push({ folder, reason: reasonOf(error) });
                await this.#run(folder, attempt);
            }
        }

        for (const folder of new Set([...this.#installed.keys(), ...this.#disposers.keys()])) {
            if (!present.has(folder)) {
                this.#drop(folder, "removed");
                await this.#release(folder);
            }
        }

        this.#failed = failed;

        for (const failure of failed) {
            this.#log(`extensions: ${failure.folder}: ${failure.reason}`);
        }

        for (const listener of this.#listeners) {
            listener();
        }
    }

    /** Folders that hold a `server.ts`, in name order. A folder with only web code is not one. */
    async #folders(): Promise<string[]> {
        const entries = await readdir(this.#dir, { withFileTypes: true });
        const folders: string[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
                continue;
            }

            const file = join(this.#dir, entry.name, "server.ts");

            try {
                await stat(file);
                folders.push(entry.name);
            } catch {
                continue;
            }
        }

        return folders.sort();
    }

    /** Imports one folder and builds its extension, checking the name the whole design relies on. */
    async #build(folder: string, attempt: Disposer[]): Promise<Extension | undefined> {
        if (RESERVED.has(folder)) {
            throw new Error("the name is reserved by the core");
        }

        const file = join(this.#dir, folder, "server.ts");
        const module: { default?: (host: Host) => unknown; status?: StatusProvider } = await import(
            `${pathToFileURL(file).href}?v=${this.#generation}`
        );

        if (typeof module.default !== "function") {
            throw new Error("server.ts has no default function export");
        }

        const result: unknown = await module.default({
            name: folder,
            cwd: this.#cwd,
            dataDir: this.#dataDir,
            log: this.#log,
            onDispose: (dispose) => {
                attempt.push(dispose);
            },
        });

        if (result === undefined) {
            return undefined;
        }

        if (!isExtension(result)) {
            throw new Error("the default export must return an extension or nothing");
        }

        if (result.name !== folder) {
            throw new Error(
                `the extension is named "${result.name}"; it must be named "${folder}"`,
            );
        }

        if (typeof module.status === "function") {
            this.#status.set(folder, module.status);
        } else {
            this.#status.delete(folder);
        }

        return result;
    }

    #drop(folder: string, why: string): void {
        this.#status.delete(folder);

        const extension = this.#installed.get(folder);

        if (extension === undefined) {
            return;
        }

        this.#registry.uninstall(extension);
        this.#installed.delete(folder);
        this.#log(`extensions: ${folder} ${why}`);
    }

    /** Makes `next` the live disposers of the folder, then runs the ones it replaced. */
    async #swap(folder: string, next: Disposer[]): Promise<void> {
        const old = this.#disposers.get(folder) ?? [];

        this.#disposers.set(folder, next);
        await this.#run(folder, old);
    }

    /** Runs and forgets the live disposers of the folder. */
    async #release(folder: string): Promise<void> {
        const old = this.#disposers.get(folder) ?? [];

        this.#disposers.delete(folder);
        await this.#run(folder, old);
    }

    /** One that throws or rejects is logged; the rest still run. */
    async #run(folder: string, disposers: readonly Disposer[]): Promise<void> {
        for (const dispose of disposers) {
            try {
                await dispose();
            } catch (error) {
                this.#log(`extensions: ${folder}: dispose failed: ${reasonOf(error)}`);
            }
        }
    }
}
