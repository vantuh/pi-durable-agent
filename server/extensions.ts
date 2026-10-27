/**
 * The extension seam. One folder in `extensions/` is one extension, its name is the folder's name, and
 * a folder that fails to load keeps whatever it installed last time. Everything the app can do beyond
 * the core is a folder here.
 */

import { type FSWatcher, realpathSync, watch } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerHooks } from "node:module";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
    Api,
    AssistantMessage,
    CacheRetention,
    Message,
    Model,
    ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { EntryRecord, Extension, Registry } from "@earendil-works/pi-durable";

import type { ClientStatus, ExtensionNotice } from "../shared/protocol.ts";
import type { FetchWrapper, RequestShaper, ResolveModelAuth } from "./model-requests.ts";

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
    /**
     * Calls `listener` after every commit of every conversation in this process. It is removed when
     * a newer version replaces this one, when the folder goes or is turned off, and when the server
     * stops. A throw or rejection is logged without data and stops nothing else. A listener of a
     * version that loads later is first called with the newest view of each session, as a baseline.
     */
    readonly onCommit: (listener: CommitListener) => void;
    /** Shapes provider payloads; removed with this extension version. */
    readonly shapeModelRequests: (shape: RequestShaper) => void;
    /** Wraps the resolved HTTP transport; never retain or log authorization headers. */
    readonly wrapModelFetch: (wrap: FetchWrapper) => void;
    /** Resolves current provider auth through Pi, including refresh. Never persist or log it. */
    readonly resolveModelAuth: ResolveModelAuth;
    /** The context window of a model in the catalog, in tokens. */
    readonly contextWindow: (provider: string, modelId: string) => number | undefined;
    /**
     * What one conversation would send next and one request on top of it, for keeping its provider
     * cache warm without adding to its transcript. Undefined for a session the server does not know.
     */
    readonly sessionRequest: (session: number) => Promise<SessionRequest | undefined>;
    /**
     * The name the sidebar shows for a session, as the owner set it or as its first question gives
     * it; null while it has neither. The core owns titles, so an extension that shows a session asks.
     */
    readonly sessionTitle: (session: number) => Promise<string | null>;
    /**
     * The name someone gave a session, by hand or through an extension; null while it has none. The
     * first question the sidebar falls back to is not a name: it is what an unnamed session shows.
     */
    readonly sessionName: (session: number) => Promise<string | null>;
    /** Names a session: the sidebar shows it from then on, and an empty title goes back to the first question. */
    readonly setSessionTitle: (session: number, title: string) => Promise<void>;
    /**
     * What the session's row says instead of the working pulse, for as long as this version is
     * installed; `undefined` takes it back. Dropped with the version that set it.
     */
    readonly setSessionMark: (session: number, mark: string | undefined) => void;
};

/** What one request on top of a conversation may ask for beyond its own messages. */
export type SessionSendOptions = {
    /** Stands in for the conversation's system messages; absent sends none of its own. */
    readonly systemPrompt?: string;
    readonly maxTokens?: number;
    /** Defaults to the long cache a conversation's own requests use. */
    readonly cacheRetention?: CacheRetention;
    readonly sessionId?: string;
    /** Absent inherits the conversation's level; "off" explicitly disables thinking. */
    readonly reasoning?: ModelThinkingLevel;
};

/** One conversation's next request: the model, the context it would send, and one request on top. */
export type SessionRequest = {
    readonly model: Model<Api>;
    /** The model context of the next request, its system messages included. */
    readonly messages: readonly Message[];
    /** One request with these messages on the long cache; nothing reaches the transcript. */
    readonly send: (
        messages: readonly Message[],
        signal: AbortSignal,
        options?: SessionSendOptions,
    ) => Promise<AssistantMessage>;
};

/** One conversation after a commit: what a commit listener may read. */
export type CommitView = {
    readonly session: { readonly id: number; readonly cwd: string | null };
    readonly entries: readonly EntryRecord[];
    readonly busy: boolean;
};

export type CommitListener = (view: CommitView) => void | Promise<void>;

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

/** What an action receives. `args` is whatever the browser sent: the action validates it. */
export type ActionCall = {
    readonly args: unknown;
    /** The session the call was made from, or null when it was made from none. */
    readonly session: { readonly id: number; readonly cwd: string | null } | null;
};

/** A folder's entry in its `actions` export. Its return value must be JSON-serialisable. */
export type Action = (call: ActionCall) => unknown;

/** The `actions` export: the record itself, or a function of the host when actions need its paths. */
export type ActionsExport = Record<string, Action> | ((host: Host) => Record<string, Action>);

/** Raw HTTP under /api/extensions/:name/http/*; needed for HTML, binary bodies and SSE. */
export type HttpHandler = (call: {
    request: IncomingMessage;
    response: ServerResponse;
    /** The namespace-relative path, including its query string. */
    path: string;
}) => void | Promise<void>;

/** Thrown by an action for bad input from the caller; the route answers 400 with the message. */
export class ActionError extends Error {}

/** Thrown for an unknown extension or action; the route answers 404. */
export class ActionNotFound extends Error {}

/** Checks the body of an action request: an object or nothing, and a positive integer `session`. */
export function parseActionBody(body: unknown): { session: number | undefined; args: unknown } {
    if (body === undefined) {
        return { session: undefined, args: undefined };
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new ActionError("the body must be a JSON object");
    }

    const session: unknown = Reflect.get(body, "session");

    if (session !== undefined && !(Number.isSafeInteger(session) && Number(session) > 0)) {
        throw new ActionError("session must be a positive integer");
    }

    return {
        session: typeof session === "number" ? session : undefined,
        args: Reflect.get(body, "args"),
    };
}

export type LoadFailure = { folder: string; reason: string };

/** A folder's optional named export `meta`: what the owner sees in the list of extensions. */
export type ExtensionMeta = { title: string; description: string };

/** One folder as the owner sees it. `error` is why the last load failed, if it did. */
export type ExtensionInfo = {
    name: string;
    title: string;
    description: string;
    enabled: boolean;
    installed: boolean;
    error?: string;
};

/** Where the owner's choice is kept, in the data directory. */
const STATE_FILE = "extensions.json";

/** Installed by the core, so no folder may take the name. */
const RESERVED = new Set(["coding-tools"]);

/** How long a burst of saves is collected before loading again. */
const SETTLE_MS = 150;

/** The `extensions/` directories of every `Extensions` in this process, as paths ending in a separator. */
const roots = new Set<string>();
let hooked = false;

/**
 * Gives a helper the version query of the module that imports it, so a reload runs new helper code.
 * Only files inside the same extension folder get it: packages and core files stay single instances.
 */
function versionHelpers(): void {
    if (hooked) {
        return;
    }

    hooked = true;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            const resolved = nextResolve(specifier, context);
            const parent = context.parentURL;

            if (
                parent === undefined ||
                !parent.startsWith("file:") ||
                !resolved.url.startsWith("file:")
            ) {
                return resolved;
            }

            const version = new URL(parent).searchParams.get("v");

            if (version === null) {
                return resolved;
            }

            const from = fileURLToPath(parent);
            const to = fileURLToPath(resolved.url);

            for (const root of roots) {
                if (!from.startsWith(root)) {
                    continue;
                }

                const folder = `${root}${from.slice(root.length).split(sep)[0] ?? ""}${sep}`;

                if (to.startsWith(folder) && !to.includes(`${sep}node_modules${sep}`)) {
                    const url = new URL(resolved.url);

                    url.searchParams.set("v", version);

                    return { ...resolved, url: url.href };
                }
            }

            return resolved;
        },
    });
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The `actions` export as a map, nothing when absent. Throws when it is not an object of functions. */
function actionsOf(value: unknown): ReadonlyMap<string, Action> | undefined {
    if (value === undefined) {
        return undefined;
    }

    const proto: unknown =
        typeof value === "object" && value !== null ? Reflect.getPrototypeOf(value) : 0;

    if (proto !== Object.prototype && proto !== null) {
        throw new Error("the `actions` export must be a plain object of functions");
    }

    const actions = new Map<string, Action>();

    for (const [name, action] of Object.entries(value ?? {})) {
        if (typeof action !== "function") {
            throw new Error(`the action "${name}" is not a function`);
        }

        actions.set(name, (call) => action(call));
    }

    return actions;
}

/** The `meta` export, or the folder's name with no description when absent. Throws when it is bad. */
function isRecord(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function metaOf(folder: string, value: unknown): ExtensionMeta {
    if (value === undefined) {
        return { title: folder, description: "" };
    }

    const title: unknown = isRecord(value) ? Reflect.get(value, "title") : undefined;
    const description: unknown = isRecord(value) ? Reflect.get(value, "description") : undefined;

    if (
        typeof title !== "string" ||
        title === "" ||
        typeof description !== "string" ||
        description === ""
    ) {
        throw new Error("the `meta` export must be { title, description }, both non-empty strings");
    }

    return { title, description };
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
    readonly #notify: (notice: ExtensionNotice) => void;
    readonly #pending = new Set<string>();
    readonly #installed = new Map<string, Extension>();
    readonly #status = new Map<string, StatusProvider>();
    readonly #actions = new Map<string, ReadonlyMap<string, Action>>();
    readonly #http = new Map<string, HttpHandler>();
    readonly #listeners = new Set<() => void>();
    /** Per folder, the disposers of the version that is live now. */
    readonly #disposers = new Map<string, Disposer[]>();
    /** The newest view of each session: a listener that arrives later starts from it. */
    readonly #lastViews = new Map<number, CommitView>();
    /** Per folder, the commit listeners of the version that is live now. */
    readonly #commits = new Map<string, CommitListener[]>();

    readonly #shapers = new Set<RequestShaper>();
    readonly #fetchWrappers = new Set<FetchWrapper>();
    readonly #resolveModelAuth: ResolveModelAuth;
    readonly #contextWindow: Host["contextWindow"];
    readonly #sessionRequest: Host["sessionRequest"];
    readonly #sessionTitle: Host["sessionTitle"];
    readonly #sessionName: Host["sessionName"];
    readonly #setSessionTitle: Host["setSessionTitle"];
    readonly #sessionListChanged: () => void;
    /** Per folder, the marks its live version put on session rows; dropped with that version. */
    readonly #marks = new Map<string, Map<number, string>>();

    get fetchWrappers(): readonly FetchWrapper[] {
        return [...this.#fetchWrappers];
    }

    get requestShapers(): readonly RequestShaper[] {
        return [...this.#shapers];
    }

    #watcher: FSWatcher | undefined;
    #generation = 0;
    #failed: LoadFailure[] = [];
    #disabled = new Set<string>();
    /** Every folder the last load saw, with the meta it could read. */
    #known = new Map<string, ExtensionMeta>();
    #queue: Promise<void> = Promise.resolve();
    #timer: NodeJS.Timeout | undefined;

    constructor(options: {
        registry: Registry;
        dir: string;
        cwd: string;
        dataDir: string;
        log: (message: string) => void;
        notify?: (notice: ExtensionNotice) => void;
        resolveModelAuth?: ResolveModelAuth;
        contextWindow?: Host["contextWindow"];
        sessionRequest?: Host["sessionRequest"];
        sessionTitle?: Host["sessionTitle"];
        sessionName?: Host["sessionName"];
        setSessionTitle?: Host["setSessionTitle"];
        sessionListChanged?: () => void;
    }) {
        this.#registry = options.registry;
        this.#dir = options.dir;
        this.#cwd = options.cwd;
        this.#dataDir = options.dataDir;
        this.#log = options.log;
        this.#notify = options.notify ?? (() => undefined);
        this.#resolveModelAuth = options.resolveModelAuth ?? (() => Promise.resolve(undefined));
        this.#contextWindow = options.contextWindow ?? (() => undefined);
        this.#sessionRequest = options.sessionRequest ?? (() => Promise.resolve(undefined));
        this.#sessionTitle = options.sessionTitle ?? (() => Promise.resolve(null));
        this.#sessionName = options.sessionName ?? (() => Promise.resolve(null));
        this.#setSessionTitle = options.setSessionTitle ?? (() => Promise.resolve());
        this.#sessionListChanged = options.sessionListChanged ?? (() => undefined);
        // Node resolves symlinks, so the hook sees real paths (macOS: /var is /private/var).
        roots.add(join(realpathSync(options.dir), sep));
        versionHelpers();
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

            const disabled = await this.#readDisabled();

            if (enabled) {
                disabled.delete(name);
            } else {
                disabled.add(name);
            }

            await mkdir(this.#dataDir, { recursive: true });

            const file = join(this.#dataDir, STATE_FILE);
            const temp = `${file}.tmp`;

            await writeFile(temp, JSON.stringify({ disabled: [...disabled].sort() }));
            await rename(temp, file);
            await this.#load();

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
            this.#deliver(folder, listeners, view);
        }
    }

    #deliver(folder: string, listeners: readonly CommitListener[], view: CommitView): void {
        for (const listener of listeners) {
            try {
                void Promise.resolve(listener(view)).catch(() => {
                    this.#log(`extensions: ${folder}: commit listener rejected`);
                });
            } catch {
                this.#log(`extensions: ${folder}: commit listener threw`);
            }
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

    /** Loads again whenever anything under `extensions/` changes. */
    watch(): void {
        this.#watcher = watch(this.#dir, { recursive: true }, (_event, filename) => {
            if (filename === null) {
                return;
            }
            const folder = filename.split(sep)[0];
            if (folder === undefined || folder.startsWith(".") || folder.startsWith("_")) {
                return;
            }
            this.#pending.add(folder);
            if (this.#timer !== undefined) {
                clearTimeout(this.#timer);
            }

            this.#timer = setTimeout(() => {
                this.#timer = undefined;
                const changed = new Set(this.#pending);
                this.#pending.clear();
                void this.load(changed).catch((error: unknown) => {
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

        this.#http.clear();
        this.#commits.clear();
        this.#lastViews.clear();

        for (const folder of [...this.#disposers.keys()]) {
            await this.#release(folder);
        }
    }

    async #load(changed?: ReadonlySet<string>): Promise<void> {
        this.#generation += 1;

        const present = new Set<string>();
        const notices: ExtensionNotice[] = [];
        const failed: LoadFailure[] =
            changed === undefined ? [] : this.#failed.filter(({ folder }) => !changed.has(folder));

        this.#disabled = await this.#readDisabled();

        for (const folder of await this.#folders()) {
            present.add(folder);
            if (changed !== undefined && !changed.has(folder)) {
                continue;
            }
            const loaded = this.#disposers.has(folder);

            const attempt: Disposer[] = [];
            const commits: CommitListener[] = [];

            try {
                const built = await this.#build(folder, attempt, commits);

                if (built === "disabled") {
                    this.#drop(folder, "disabled");
                } else if (built === undefined) {
                    // The module ran, so what it registered is live: it replaces the old version's.
                    this.#drop(folder, "installs nothing");
                } else {
                    this.#registry.install(built.extension);
                    this.#installed.set(folder, built.extension);
                    this.#setOrDelete(this.#actions, folder, built.actions);
                    this.#setOrDelete(this.#http, folder, built.http);
                    this.#setOrDelete(this.#status, folder, built.status);
                }

                this.#setOrDelete(
                    this.#commits,
                    folder,
                    commits.length === 0 ? undefined : commits,
                );

                for (const view of this.#lastViews.values()) {
                    this.#deliver(folder, commits, view);
                }

                await this.#swap(folder, attempt);
                if (changed !== undefined && built !== "disabled") {
                    notices.push({
                        level: "success",
                        message: `Extension “${folder}” ${loaded ? "reloaded" : "loaded"}`,
                    });
                }
            } catch (error) {
                failed.push({ folder, reason: reasonOf(error) });
                if (changed !== undefined && !this.#disabled.has(folder)) {
                    notices.push({
                        level: "error",
                        message: `Could not load extension “${folder}”: ${reasonOf(error)}${loaded ? ". Previous version is still active." : ""}`,
                    });
                }
                await this.#run(folder, attempt);

                if (this.#disabled.has(folder)) {
                    this.#drop(folder, "disabled");
                    this.#commits.delete(folder);
                    await this.#release(folder);
                }
            }
        }

        for (const folder of new Set([...this.#installed.keys(), ...this.#disposers.keys()])) {
            if (!present.has(folder)) {
                this.#drop(folder, "removed");
                this.#commits.delete(folder);
                await this.#release(folder);
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
            this.#notify(notice);
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

    /** A missing or broken file means every folder is on. */
    async #readDisabled(): Promise<Set<string>> {
        try {
            const state: unknown = JSON.parse(
                await readFile(join(this.#dataDir, STATE_FILE), "utf8"),
            );
            const list: unknown =
                typeof state === "object" && state !== null
                    ? Reflect.get(state, "disabled")
                    : undefined;

            return new Set(
                Array.isArray(list) ? list.filter((item) => typeof item === "string") : [],
            );
        } catch {
            return new Set();
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

    /**
     * Imports one folder and builds its extension, checking the name the whole design relies on. A
     * disabled folder is imported only to read `meta`; its default export is not called.
     */
    async #build(
        folder: string,
        attempt: Disposer[],
        commits: CommitListener[],
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

        const host: Host = {
            name: folder,
            cwd: this.#cwd,
            dataDir: this.#dataDir,
            log: this.#log,
            onDispose: (dispose) => {
                attempt.push(dispose);
            },
            resolveModelAuth: this.#resolveModelAuth,
            contextWindow: this.#contextWindow,
            sessionRequest: (session) => this.#sessionRequest(session),
            sessionTitle: (session) => this.#sessionTitle(session),
            sessionName: (session) => this.#sessionName(session),
            setSessionTitle: (session, title) => this.#setSessionTitle(session, title),
            setSessionMark: (session, mark) => {
                const marks = this.#marks.get(folder) ?? new Map<number, string>();

                this.#marks.set(folder, marks);
                if (mark === undefined) {
                    marks.delete(session);
                } else {
                    marks.set(session, mark);
                }
                this.#sessionListChanged();
            },
            wrapModelFetch: (wrap) => {
                this.#fetchWrappers.add(wrap);
                attempt.push(() => {
                    this.#fetchWrappers.delete(wrap);
                });
            },
            shapeModelRequests: (shape) => {
                this.#shapers.add(shape);
                attempt.push(() => {
                    this.#shapers.delete(shape);
                });
            },
            onCommit: (listener) => {
                commits.push(listener);
            },
        };
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
        return {
            extension: result,
            http,
            actions: actionsOf(
                typeof module.actions === "function" ? module.actions(host) : module.actions,
            ),
            status: typeof module.status === "function" ? module.status : undefined,
        };
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

    /** Makes `next` the live disposers of the folder, then runs the ones it replaced. */
    async #swap(folder: string, next: Disposer[]): Promise<void> {
        const old = this.#disposers.get(folder) ?? [];

        this.#disposers.set(folder, next);
        this.#dropMarks(folder);
        await this.#run(folder, old);
    }

    /** Runs and forgets the live disposers of the folder. */
    async #release(folder: string): Promise<void> {
        const old = this.#disposers.get(folder) ?? [];

        this.#disposers.delete(folder);
        this.#dropMarks(folder);
        await this.#run(folder, old);
    }

    /** A version that goes away takes its marks with it; a session row must not keep saying "Paused". */
    #dropMarks(folder: string): void {
        if (this.#marks.delete(folder)) {
            this.#sessionListChanged();
        }
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
