/**
 * The extension seam. One folder in `extensions/` is one extension, its name is the folder's name, and
 * a folder that fails to load keeps whatever it installed last time. Everything the app can do beyond
 * the core is a folder here.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Extension, Registry } from "@earendil-works/pi-durable";

import { messageOf } from "../../shared/guards.ts";
import type { ClientStatus, ExtensionNotice } from "../../shared/protocol.ts";
import { ActionNotFound } from "../errors.ts";
import type { FetchWrapper, RequestShaper } from "../model-requests.ts";
import { collisionOf } from "./collision.ts";
import type {
    Action,
    ActionCall,
    ActionsExport,
    CommitListener,
    CommitView,
    ExtensionInfo,
    ExtensionMeta,
    FolderGroup,
    Host,
    HttpHandler,
    LoadFailure,
    SessionGoneListener,
    StatusProvider,
    StatusView,
} from "./contract.ts";
import { readDisabled, serverFolders, writeDisabled } from "./discovery.ts";
import { createHost, type HostServices, hostServices } from "./host.ts";
import { deliverCommit, deliverGone } from "./listeners.ts";
import { actionsOf, isExtension, metaOf } from "./module-exports.ts";
import { versionHelpersIn } from "./resolve-hook.ts";
import { newVersion, track, type Version, Versions } from "./versions.ts";
import { type FolderWatch, watchFolders } from "./watcher.ts";

/** Installed by the core, so no folder may take the name. */
const RESERVED = new Set(["coding-tools"]);

export class Extensions {
    readonly #registry: Registry;
    readonly #dir: string;
    readonly #cwd: string;
    readonly #dataDir: string;
    readonly #log: (message: string) => void;
    readonly #services: HostServices;
    readonly #installed = new Map<string, Extension>();
    readonly #status = new Map<string, StatusProvider>();
    readonly #actions = new Map<string, ReadonlyMap<string, Action>>();
    readonly #http = new Map<string, HttpHandler>();
    readonly #listeners = new Set<() => void>();
    /** The live version of each folder, and the ones waiting for their running calls to end. */
    readonly #versions: Versions;
    /** The newest view of each session: a listener that arrives later starts from it. */
    readonly #lastViews = new Map<number, CommitView>();
    /** Per folder, the commit listeners of the version that is live now. */
    readonly #commits = new Map<string, CommitListener[]>();
    /** Per folder, the session-gone listeners of the version that is live now. */
    readonly #gone = new Map<string, SessionGoneListener[]>();
    /** Per folder, the folder resolvers of the version that is live now. */
    readonly #groups = new Map<string, readonly FolderGroup[]>();

    readonly #shapers = new Set<RequestShaper>();
    readonly #fetchWrappers = new Set<FetchWrapper>();
    /** Per folder, the marks its live version put on session rows; dropped with that version. */
    readonly #marks = new Map<string, Map<number, string>>();

    get fetchWrappers(): readonly FetchWrapper[] {
        return [...this.#fetchWrappers];
    }

    get requestShapers(): readonly RequestShaper[] {
        return [...this.#shapers];
    }

    #watcher: FolderWatch | undefined;
    #generation = 0;
    #failed: LoadFailure[] = [];
    #disabled = new Set<string>();
    /** Every folder the last load saw, with the meta it could read. */
    #known = new Map<string, ExtensionMeta>();
    #queue: Promise<void> = Promise.resolve();

    constructor(
        options: {
            registry: Registry;
            dir: string;
            cwd: string;
            dataDir: string;
            log: (message: string) => void;
        } & Partial<HostServices>,
    ) {
        this.#registry = options.registry;
        this.#dir = options.dir;
        this.#cwd = options.cwd;
        this.#dataDir = options.dataDir;
        this.#log = options.log;
        this.#versions = new Versions(options.log);
        this.#services = hostServices(options);
        versionHelpersIn(options.dir);
    }

    /** The folders installed now, sorted. */
    get names(): string[] {
        return [...this.#installed.keys()].sort();
    }

    /** Folders that failed to load, and why. The extension they had before is still installed. */
    get failed(): readonly LoadFailure[] {
        return this.#failed;
    }

    /** Every folder the last load saw, sorted by name. */
    get list(): ExtensionInfo[] {
        return [...this.#known.keys()].sort().flatMap((name) => this.#info(name) ?? []);
    }

    /**
     * Turns a folder on or off, stores the choice, and loads again. Throws `ActionNotFound` for a
     * folder the last load did not see.
     */
    setEnabled(name: string, enabled: boolean): Promise<ExtensionInfo> {
        const run = this.#queue.then(async () => {
            if (!this.#known.has(name)) {
                throw new ActionNotFound(`no extension "${name}"`);
            }

            const disabled = await readDisabled(this.#dataDir);

            if (enabled) {
                disabled.delete(name);
            } else {
                disabled.add(name);
            }

            await writeDisabled(this.#dataDir, disabled);
            // Only this folder: reloading the rest would run their disposers (a pause lets go, MCP reconnects).
            await this.#load(new Set([name]));

            const info = this.#info(name);

            if (info === undefined) {
                throw new ActionNotFound(`no extension "${name}"`);
            }

            return info;
        });

        this.#queue = run.then(
            () => undefined,
            () => undefined,
        );

        return run;
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

    /** A session's mark from any installed folder, in folder order; undefined when none has one. */
    markOf(session: number): string | undefined {
        for (const folder of [...this.#marks.keys()].sort()) {
            const mark = this.#marks.get(folder)?.get(session);

            if (mark !== undefined) {
                return mark;
            }
        }

        return undefined;
    }

    /** The folder `cwd` is shown under, from the first installed folder that answers one; undefined for a folder of its own. */
    async groupOf(cwd: string): Promise<string | undefined> {
        for (const folder of [...this.#groups.keys()].sort()) {
            for (const resolve of this.#groups.get(folder) ?? []) {
                try {
                    const under = await resolve(cwd);

                    if (under !== undefined) {
                        return under;
                    }
                } catch {
                    // A resolver that throws leaves the folder to the others, or to itself.
                }
            }
        }

        return undefined;
    }

    /** Runs one action of an installed folder. Throws `ActionNotFound` when either is missing. */
    async call(extension: string, action: string, call: ActionCall): Promise<unknown> {
        const actions = this.#actions.get(extension);

        if (actions === undefined) {
            throw new ActionNotFound(`no extension "${extension}" has actions`);
        }

        const run = actions.get(action);

        if (run === undefined) {
            throw new ActionNotFound(`extension "${extension}" has no action "${action}"`);
        }

        return await run(call);
    }

    async serveHttp(extension: string, call: Parameters<HttpHandler>[0]): Promise<void> {
        const handler = this.#http.get(extension);
        if (handler === undefined) {
            throw new ActionNotFound(`extension "${extension}" has no HTTP handler`);
        }
        await handler(call);
    }

    /**
     * Hands a commit to the listeners of every installed version. One that fails is logged. A version
     * that loads later first gets the newest view of each session, as a baseline.
     */
    publish(view: CommitView): void {
        this.#lastViews.set(view.session.id, view);

        for (const [folder, listeners] of [...this.#commits]) {
            deliverCommit(this.#log, folder, listeners, view);
        }
    }

    /** Forgets a session that is gone, so no version that loads later is replayed its last view. */
    forget(session: number): void {
        this.#lastViews.delete(session);

        for (const [folder, listeners] of [...this.#gone]) {
            deliverGone(this.#log, folder, listeners, session);
        }
    }

    /** Calls `listener` after every load, so the page can drop a field whose folder went away. */
    onChange(listener: () => void): void {
        this.#listeners.add(listener);
    }

    /** Loads all folders silently, or reports results for a changed set. Loads never interleave. */
    load(changed?: ReadonlySet<string>): Promise<void> {
        const run = this.#queue.then(() => this.#load(changed));

        // The caller gets its own rejection; the queue itself must stay usable for later loads.
        this.#queue = run.catch(() => undefined);

        return run;
    }

    /** Loads again whenever anything under `extensions/` changes. A second call does nothing while the watch runs. */
    watch(): void {
        if (this.#watcher !== undefined) {
            return;
        }

        this.#watcher = watchFolders(this.#dir, (changed) => {
            void this.load(changed).catch((error: unknown) => {
                this.#log(`extensions: ${messageOf(error)}`);
            });
        });
    }

    /** Stops watching, finishes a running load, and runs every disposer. Safe to call twice. */
    async dispose(): Promise<void> {
        this.#watcher?.close();
        this.#watcher = undefined;

        await this.#queue;

        this.#http.clear();
        this.#commits.clear();
        this.#gone.clear();
        this.#groups.clear();
        this.#lastViews.clear();

        for (const folder of this.#versions.folders) {
            await this.#release(folder, false);
        }
        await this.#versions.finish();
    }

    async #load(changed?: ReadonlySet<string>): Promise<void> {
        this.#generation += 1;

        const present = new Set<string>();
        const notices: ExtensionNotice[] = [];
        const failed: LoadFailure[] =
            changed === undefined ? [] : this.#failed.filter(({ folder }) => !changed.has(folder));

        this.#disabled = await readDisabled(this.#dataDir);

        for (const folder of await serverFolders(this.#dir)) {
            present.add(folder);
            if (changed !== undefined && !changed.has(folder)) {
                continue;
            }
            const loaded = this.#versions.has(folder);

            const attempt = newVersion();
            const commits: CommitListener[] = [];
            const gone: SessionGoneListener[] = [];
            const groups: FolderGroup[] = [];
            const activations: (() => void)[] = [];

            try {
                const built = await this.#build(
                    folder,
                    attempt,
                    commits,
                    gone,
                    groups,
                    activations,
                );

                if (built === "disabled") {
                    this.#drop(folder, "disabled");
                } else if (built === undefined) {
                    // The module ran, so what it registered is live: it replaces the old version's.
                    this.#drop(folder, "installs nothing");
                    for (const activate of activations) {
                        activate();
                    }
                } else {
                    this.#install(folder, built.extension, activations);
                    this.#setOrDelete(this.#actions, folder, built.actions);
                    this.#setOrDelete(this.#http, folder, built.http);
                    this.#setOrDelete(this.#status, folder, built.status);
                }

                this.#setOrDelete(
                    this.#commits,
                    folder,
                    commits.length === 0 ? undefined : commits,
                );
                this.#setOrDelete(this.#gone, folder, gone.length === 0 ? undefined : gone);

                // Rows carry the answer, so they are read again when this folder had or has one.
                if (this.#groups.has(folder) || groups.length > 0) {
                    this.#services.sessionListChanged();
                }
                this.#setOrDelete(this.#groups, folder, groups.length === 0 ? undefined : groups);

                for (const view of this.#lastViews.values()) {
                    deliverCommit(this.#log, folder, commits, view);
                }

                await this.#swap(folder, attempt);
                if (changed !== undefined && built !== "disabled") {
                    notices.push({
                        level: "success",
                        message: `Extension “${folder}” ${loaded ? "reloaded" : "loaded"}`,
                    });
                }
            } catch (error) {
                failed.push({ folder, reason: messageOf(error) });
                if (changed !== undefined && !this.#disabled.has(folder)) {
                    notices.push({
                        level: "error",
                        message: `Could not load extension “${folder}”: ${messageOf(error)}${loaded ? ". Previous version is still active." : ""}`,
                    });
                }
                await this.#versions.run(folder, attempt.disposers);

                if (this.#disabled.has(folder)) {
                    this.#drop(folder, "disabled");
                    this.#commits.delete(folder);
                    this.#gone.delete(folder);
                    await this.#release(folder, true);
                }
            }
        }

        for (const folder of new Set([...this.#installed.keys(), ...this.#versions.folders])) {
            if (!present.has(folder)) {
                this.#drop(folder, "removed");
                this.#commits.delete(folder);
                this.#gone.delete(folder);
                await this.#release(folder, true);
                if (changed !== undefined) {
                    notices.push({ level: "success", message: `Extension “${folder}” removed` });
                }
            }
        }

        this.#failed = failed.filter(({ folder }) => present.has(folder));

        for (const folder of [...this.#known.keys()]) {
            if (!present.has(folder)) {
                this.#known.delete(folder);
            }
        }

        for (const failure of failed) {
            this.#log(`extensions: ${failure.folder}: ${failure.reason}`);
        }

        for (const listener of this.#listeners) {
            listener();
        }
        for (const notice of notices) {
            this.#services.notify(notice);
        }
    }

    #info(name: string): ExtensionInfo | undefined {
        const meta = this.#known.get(name);

        if (meta === undefined) {
            return undefined;
        }

        const error = this.#failed.find((failure) => failure.folder === name)?.reason;

        return {
            name,
            ...meta,
            enabled: !this.#disabled.has(name),
            installed: this.#installed.has(name),
            ...(error === undefined ? {} : { error }),
        };
    }

    /**
     * Imports one folder and builds its extension, checking the name the whole design relies on. A
     * disabled folder is imported only to read `meta`; its default export is not called.
     */
    async #build(
        folder: string,
        attempt: Version,
        commits: CommitListener[],
        gone: SessionGoneListener[],
        groups: FolderGroup[],
        activations: (() => void)[],
    ): Promise<
        | {
              extension: Extension;
              actions: ReadonlyMap<string, Action> | undefined;
              status: StatusProvider | undefined;
              http: HttpHandler | undefined;
          }
        | undefined
        | "disabled"
    > {
        // Listed even when the import fails; a good `meta` below replaces the name.
        this.#known.set(folder, this.#known.get(folder) ?? { title: folder, description: "" });

        if (RESERVED.has(folder)) {
            throw new Error("the name is reserved by the core");
        }

        const file = join(this.#dir, folder, "server.ts");
        const module: {
            default?: (host: Host) => unknown;
            status?: StatusProvider;
            actions?: ActionsExport;
            meta?: unknown;
            http?: (host: Host) => HttpHandler;
        } = await import(`${pathToFileURL(file).href}?v=${this.#generation}`);

        this.#known.set(folder, metaOf(folder, module.meta));

        if (this.#disabled.has(folder)) {
            return "disabled";
        }

        if (typeof module.default !== "function") {
            throw new Error("server.ts has no default function export");
        }

        const host = createHost({
            folder,
            cwd: this.#cwd,
            dataDir: this.#dataDir,
            log: this.#log,
            services: this.#services,
            shared: {
                marks: this.#marks,
                shapers: this.#shapers,
                fetchWrappers: this.#fetchWrappers,
                toolOwner: (tool) => this.#toolOwner(tool),
            },
            registrations: { disposers: attempt.disposers, commits, gone, groups, activations },
        });
        const result: unknown = await module.default(host);

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

        if (module.http !== undefined && typeof module.http !== "function") {
            throw new Error("the http export must be a factory function");
        }
        const http = module.http?.(host);
        if (module.http !== undefined && typeof http !== "function") {
            throw new Error("the http factory must return a function");
        }
        const actions = actionsOf(
            typeof module.actions === "function" ? module.actions(host) : module.actions,
        );
        // Hooks are not counted: a pause parks one on purpose and its disposer is what lets it go.
        const tools = result.tools?.map((tool) => ({
            ...tool,
            execute: (...args: Parameters<typeof tool.execute>) =>
                track(attempt, () => tool.execute(...args)),
        }));

        return {
            extension: tools === undefined ? result : { ...result, tools },
            http: http === undefined ? undefined : (call) => track(attempt, () => http(call)),
            actions:
                actions === undefined
                    ? undefined
                    : new Map(
                          [...actions].map(([name, run]) => [
                              name,
                              (call) => track(attempt, async () => await run(call)),
                          ]),
                      ),
            status: typeof module.status === "function" ? module.status : undefined,
        };
    }

    /** The installed folder whose tools include `tool`; undefined for core tools and unknown names. */
    #toolOwner(tool: string): string | undefined {
        for (const [name, extension] of this.#installed) {
            if (extension.tools?.some((registered) => registered.name === tool)) {
                return name;
            }
        }

        return undefined;
    }

    #setOrDelete<T>(map: Map<string, T>, folder: string, value: T | undefined): void {
        if (value === undefined) {
            map.delete(folder);
        } else {
            map.set(folder, value);
        }
    }

    #drop(folder: string, why: string): void {
        this.#status.delete(folder);
        this.#actions.delete(folder);
        this.#http.delete(folder);

        const extension = this.#installed.get(folder);

        if (extension === undefined) {
            return;
        }

        this.#registry.uninstall(extension);
        this.#installed.delete(folder);
        this.#log(`extensions: ${folder} ${why}`);
    }

    /**
     * Installs `extension` and, in the same tick, what its build registered (providers, request
     * wrappers and shapers), so no request sees one without the other. A failure puts back what was
     * installed before.
     */
    #install(folder: string, extension: Extension, activations: readonly (() => void)[]): void {
        const taken = collisionOf(this.#registry, extension);

        if (taken !== undefined) {
            throw new Error(taken);
        }

        const previous = this.#installed.get(folder);

        this.#registry.install(extension);
        try {
            for (const activate of activations) {
                activate();
            }
        } catch (error) {
            if (previous === undefined) {
                this.#registry.uninstall(extension);
            } else {
                this.#registry.install(previous);
            }
            throw error;
        }
        this.#installed.set(folder, extension);
    }

    /** Makes `next` the live version of the folder, then retires the one it replaced. */
    async #swap(folder: string, next: Version): Promise<void> {
        const old = this.#versions.replace(folder, next);

        this.#dropMarks(folder);
        await this.#versions.retire(folder, old, true);
    }

    /** Forgets the live version of the folder and runs its disposers, after its running calls when `drain`. */
    async #release(folder: string, drain: boolean): Promise<void> {
        const old = this.#versions.remove(folder);

        this.#dropMarks(folder);
        if (this.#groups.delete(folder)) {
            this.#services.sessionListChanged();
        }
        await this.#versions.retire(folder, old, drain);
    }

    /** A version that goes away takes its marks with it; a session row must not keep saying "Paused". */
    #dropMarks(folder: string): void {
        if (this.#marks.delete(folder)) {
            this.#services.sessionListChanged();
        }
    }
}
