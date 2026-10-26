/**
 * The extension seam. One folder in `extensions/` is one extension, its name is the folder's name, and
 * a folder that fails to load keeps whatever it installed last time. Everything the app can do beyond
 * the core is a folder here.
 */

import { watch } from "node:fs";
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
};

export type ServerModule = (
    host: Host,
) => Extension | undefined | void | Promise<Extension | undefined | void>;

/** What a status provider reads: the conversation's active entries. */
export type StatusView = { readonly entries: readonly EntryRecord[] };

/**
 * A folder's optional named export `status`. It runs on every commit and returns one field for the
 * status bar, or nothing when it has no honest number to show.
 */
export type StatusProvider = (view: StatusView) => { text: string; title?: string } | undefined;

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
                    fields.push({ source: folder, ...field });
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
        this.#queue = this.#queue.then(() => this.#load());

        return this.#queue;
    }

    /** Loads again whenever anything under `extensions/` changes. */
    watch(): void {
        watch(this.#dir, { recursive: true }, () => {
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

    async #load(): Promise<void> {
        this.#generation += 1;

        const present = new Set<string>();
        const failed: LoadFailure[] = [];

        for (const folder of await this.#folders()) {
            present.add(folder);

            try {
                const extension = await this.#build(folder);

                if (extension !== undefined) {
                    this.#registry.install(extension);
                    this.#installed.set(folder, extension);
                }
            } catch (error) {
                failed.push({ folder, reason: reasonOf(error) });
            }
        }

        for (const folder of [...this.#installed.keys()]) {
            if (!present.has(folder)) {
                this.#drop(folder, "removed");
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
    async #build(folder: string): Promise<Extension | undefined> {
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
        });

        if (result === undefined) {
            this.#drop(folder, "installs nothing");

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
}
