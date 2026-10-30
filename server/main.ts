/**
 * The whole server: conversations, one event stream each, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    type Conversation,
    type ConversationDocToken,
    type ConversationId,
    createRegistry,
    Harness,
    type JsonObject,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type {
    ClientEntry,
    ClientLive,
    ServerEvent,
    SessionSummary,
    SessionsEvent,
} from "../shared/protocol.ts";
import { commitAnnouncer } from "./commit-announcer.ts";
import { Extensions, type SessionRequest } from "./extensions.ts";
import { hasOlder } from "./history.ts";
import { answer, type Route, writeEvent } from "./http.ts";
import { type Lifecycle, listen } from "./lifecycle.ts";
import { createSessionRequest, shapeModelRequests } from "./model-requests.ts";
import { observeNewConversations } from "./new-conversations.ts";
import { projectEntry, projectLive } from "./projection.ts";
import { conversationRoutes } from "./routes/conversation.ts";
import { extensionRoutes } from "./routes/extensions.ts";
import { fileRoutes } from "./routes/files.ts";
import { modelRoutes } from "./routes/models.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { knownHost, sameOrigin } from "./same-origin.ts";
import { sessionChanges } from "./session-changes.ts";
import { type Opened, Sessions, supportedLevel } from "./sessions.ts";
import { serveStatic } from "./static.ts";

type View = Awaited<ReturnType<Conversation["viewState"]>>["value"];

const context = BACKGROUND_CONTEXT;
const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = resolve(process.env["PI_DURABLE_DATA_DIR"] ?? join(process.cwd(), "data"));
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
const IDLE_HEARTBEAT_MS = 20_000;
/** A burst of changes (a run ending writes several) is sent as one list. */
const LIST_DELAY_MS = 100;
/** A child that commits all the time makes its parent's browsers ask again once per this long. */
const CHANGE_WINDOW_MS = 250;
/** How long stopping may wait for running work; what is still running resumes in the next process. */
const STOP_LIMIT_MS = 10_000;
/** `scripts/serve.ts` starts the server again when it exits with this code, and only it can. */
const RESTART_CODE = 75;
/** The IPC channel `scripts/serve.ts` opens is the only thing that starts a stopped server again. */
const SUPERVISED = typeof process.send === "function";
/**
 * The hour-long provider cache, for every conversation and for the requests extensions send on top
 * of one (keep-warm renews it). A short cache is gone before a ping can renew it, so the two agree.
 */
const STREAM = { cacheRetention: "long" } as const;

type Client = { response: ServerResponse; session: number };

const clients = new Set<Client>();
const listWatchers = new Set<ServerResponse>();
const busy = new Map<number, boolean>();
const latest = new Map<number, { opened: Opened; view: View }>();
const changes = sessionChanges({
    windowMs: CHANGE_WINDOW_MS,
    changed: (id) => {
        const current = latest.get(id);

        if (current !== undefined) {
            broadcast({ type: "live", session: id, live: liveOf(id, current.view) });
        }
    },
});
let listQueued = false;
let listChain: Promise<void> = Promise.resolve();

let models: ModelRuntime;
let runtime: ModelRuntime;
let extensions: Extensions;
let sessions: Sessions;
let harness: Harness;
let lifecycle: Lifecycle;
let rootId: number;
let routes: Route[] = [];

function send(client: Client, event: ServerEvent): void {
    writeEvent(client.response, `data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: ServerEvent): void {
    for (const client of clients) {
        if (client.session === event.session) {
            send(client, event);
        }
    }
}

function isBusy(id: number): boolean {
    return busy.get(id) === true;
}

/** The rows the browser reads, with the mark an extension put on a session; one list, one place. */
async function sessionRows(): Promise<SessionSummary[]> {
    const rows = await sessions.list(isBusy);

    return rows.map((row) => {
        const mark = extensions.markOf(row.id);

        return mark === undefined ? row : { ...row, mark };
    });
}

async function sendList(watchers: Iterable<ServerResponse>): Promise<void> {
    const list: SessionsEvent = { type: "sessions", sessions: await sessionRows() };
    const event = `data: ${JSON.stringify(list)}\n\n`;

    for (const watcher of watchers) {
        writeEvent(watcher, event);
    }
}

/** Sends the whole list to every list stream, once per burst; in order, so an older list never lands last. */
function listChanged(): void {
    if (listQueued || listWatchers.size === 0) {
        return;
    }

    listQueued = true;
    listChain = listChain.then(flushList);
}

async function flushList(): Promise<void> {
    await delay(LIST_DELAY_MS);
    listQueued = false;

    try {
        await sendList(listWatchers);
    } catch (error) {
        console.error(error);
    }
}

/** The session list stream: the whole list now, then after every change. */
async function watchList(response: ServerResponse): Promise<void> {
    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
    });
    listWatchers.add(response);
    response.on("close", () => {
        listWatchers.delete(response);
    });
    await sendList([response]);
}

function entriesOf(view: View): ClientEntry[] {
    return view.entries
        .map(projectEntry)
        .filter((entry): entry is ClientEntry => entry !== undefined);
}

/** The state `publish` last stored for a session; `attach` stores one before it returns the open. */
function viewOf(id: number): View {
    const current = latest.get(id);

    if (current === undefined) {
        throw new Error(`session ${String(id)} is not attached`);
    }

    return current.view;
}

/** The first entry of a session as `hello` will carry it, `undefined` before it has any. */
function firstEntryId(id: number): number | undefined {
    return entriesOf(viewOf(id))[0]?.id;
}

function windowOf(provider: string, modelId: string): number | undefined {
    return models.getModels().find((model) => model.provider === provider && model.id === modelId)
        ?.contextWindow;
}

/** The name the sidebar shows for a session, for an extension that has to name it too. */
async function sessionTitleOf(session: number): Promise<string | null> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    return await sessions.title(session as ConversationId);
}

/** The session that started this one, for the extensions' view of it. */
async function sessionOwnerOf(session: number): Promise<number | undefined> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    return await sessions.owner(session as ConversationId);
}

/** The name someone gave a session, without the first question the sidebar falls back to. */
async function sessionNameOf(session: number): Promise<string | null> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    return await sessions.name(session as ConversationId);
}

/** A conversation document's value for an extension that reads outside a tool call. */
async function readDocOf<T extends JsonObject>(
    doc: ConversationDocToken<T>,
    session: number,
): Promise<Readonly<T>> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    return await sessions.readDoc(doc, session as ConversationId);
}

/**
 * Names a session from an extension. The title lives in a document, so no commit carries it to the
 * browsers: the list is sent again here, or the sidebar would show the old name.
 */
async function setSessionTitleOf(session: number, title: string): Promise<void> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    await sessions.setTitle(session as ConversationId, title);
    listChanged();
}

/**
 * One conversation's next request, for an extension that reuses its cache, and one request on top: the
 * context the next request would send, and a request through the same model runtime, so the installed
 * fetch wrappers shape both. The request sends the messages it is given, the conversation's or its own.
 */
async function sessionRequestOf(session: number): Promise<SessionRequest | undefined> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value is a conversation id that came from a JSON number
    const opened = await sessions.open(session as ConversationId);

    if (opened === undefined) {
        return undefined;
    }

    const agent = await opened.conversation.agent(context);
    const ref = agent.model;

    if (ref === undefined) {
        return undefined;
    }

    const model = runtime.getModel(ref.provider, ref.modelId);

    if (model === undefined) {
        return undefined;
    }

    const { messages } = await opened.conversation.context(context);

    return createSessionRequest(runtime, model, messages, agent.thinkingLevel);
}

function liveOf(id: number, view: View): ClientLive {
    const live = projectLive(view.docs["pi.live"], view.docs["pi.usage"], view.docs["pi.inbox"]);
    const status = extensions.statuses({
        entries: view.entries,
        contextWindow: windowOf,
    });
    const revision = changes.revision(id);

    return {
        ...live,
        ...(status.length === 0 ? {} : { status }),
        ...(revision === 0 ? {} : { revision }),
    };
}

/** Sends what changed since the last commit: only new entries when nothing was rewritten. */
function publish(opened: Opened, view: View): void {
    const live = liveOf(opened.id, view);
    const entries = entriesOf(view);
    const ids = entries.map((entry) => entry.id);
    const grows = ids.length > opened.sent.length && opened.sent.every((id, at) => id === ids[at]);
    const unchanged =
        ids.length === opened.sent.length && opened.sent.every((id, at) => id === ids[at]);

    if (grows) {
        const fresh = entries.slice(opened.sent.length);

        opened.sent = ids;
        broadcast({ type: "entries", session: opened.id, entries: fresh, replace: false });
    } else if (!unchanged) {
        opened.sent = ids;
        broadcast({ type: "entries", session: opened.id, entries, replace: true });
    }

    // New entries name a session and move its time; a run starting or ending moves its mark.
    if (!unchanged || isBusy(opened.id) !== live.busy) {
        listChanged();
    }

    latest.set(opened.id, { opened, view });
    // Taken before the browsers hear of it, so a `seen` sent the moment it ends is later.
    if (busy.get(opened.id) === true && !live.busy) {
        // An unhandled rejection would end the process, and every conversation in it.
        void sessions.ended(opened.id, Date.now()).then(listChanged, (error: unknown) => {
            console.error(error);
        });
    }

    busy.set(opened.id, live.busy);
    broadcast({ type: "live", session: opened.id, live });
}

const announce = commitAnnouncer({
    cwdOf: async (id) => {
        const agent = await latest.get(id)?.opened.conversation.agent(context);

        return agent?.cwd ?? null;
    },
    ownerOf: sessionOwnerOf,
    publish: (view) => {
        extensions.publish(view);
    },
});

/** Sends a state to the browsers and, with its busy value as it is now, to the extensions. */
function observe(opened: Opened, state: View): void {
    publish(opened, state);
    void announce(opened.id, state.entries, busy.get(opened.id) === true);
}

const attaching = new Map<number, Promise<Opened | undefined>>();

/** Opens a conversation and starts forwarding its commits. A caller that comes while it opens gets the same open. */
function attach(id: number): Promise<Opened | undefined> {
    const known = attaching.get(id);

    if (known !== undefined) {
        return known;
    }

    const pending = attachOnce(id);

    attaching.set(id, pending);
    // Only the open in flight is shared: a deleted session must be refused again by `sessions.open`.
    void pending
        .finally(() => {
            attaching.delete(id);
        })
        .catch(() => undefined);

    return pending;
}

async function attachOnce(id: number): Promise<Opened | undefined> {
    // Session ids come from the browser as plain numbers; the harness brands its own.
    // A conversation id is a number at run time; the brand lives only in the type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value came from a conversation id or a JSON number
    const opened = await sessions.open(id as ConversationId);

    if (opened === undefined) {
        return undefined;
    }

    if (opened.watched) {
        return opened;
    }

    const view = await opened.conversation.viewState(context);

    opened.watched = true;
    opened.sent = view.value.entries.map((entry) => Number(entry.id));
    observe(opened, view.value);
    view.subscribe((state) => {
        observe(opened, state);
    });

    return opened;
}

/**
 * Starts the event stream of a session: the whole state first, then every change. The state is the one `publish`
 * stored for the attached view, the same state the browsers were sent up to, so no commit can reach this client
 * ahead of the `hello` that already carries it; nothing may await from reading that state to sending it.
 */
async function stream(response: ServerResponse, opened: Opened): Promise<void> {
    const id = Number(opened.id);
    let first = firstEntryId(id);
    let more = false;

    // `hasOlder` reads through the conversation's line, where a commit can land ahead of it: its answer is
    // about the first entry it asked with, so ask again until that entry stays put.
    for (;;) {
        more =
            first !== undefined &&
            (await hasOlder({ conversation: opened.conversation, context, id: first }));

        const now = firstEntryId(id);

        if (now === first) {
            break;
        }

        first = now;
    }

    const view = viewOf(id);
    const entries = entriesOf(view);

    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
    });
    const client: Client = { response, session: id };

    clients.add(client);
    client.response.on("close", () => {
        clients.delete(client);
    });

    send(client, {
        type: "hello",
        session: id,
        entries,
        live: liveOf(id, view),
        model: MODEL,
        more,
    });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (!knownHost(request.headers.host)) {
        answer(response, 403, { error: "unknown host" });

        return;
    }

    if (!url.pathname.startsWith("/api/")) {
        await serveStatic(DIST, request, response);

        return;
    }

    if (!sameOrigin(request.headers)) {
        answer(response, 403, { error: "cross-origin requests are not allowed" });

        return;
    }

    for (const route of routes) {
        const match =
            route.method === "*" || route.method === request.method
                ? route.path.exec(url.pathname)
                : null;

        if (match !== null) {
            await route.handle(request, response, url, match);

            // An extension changes a row only through the host, which sends the list itself; a panel
            // that polls an action every second must not resend every row to every device.
            if (request.method !== "GET" && !url.pathname.startsWith("/api/extensions/")) {
                listChanged();
            }

            return;
        }
    }

    answer(response, 404, { error: "not found" });
}

/** Opens everything that touches storage. Runs once the lock and the port are ours. */
async function boot(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            writeEvent(client.response, ": heartbeat\n\n");
        }

        for (const watcher of listWatchers) {
            writeEvent(watcher, ": heartbeat\n\n");
        }
    }, IDLE_HEARTBEAT_MS);

    lifecycle.onStop(() => {
        clearInterval(heartbeat);
        changes.dispose();

        return Promise.resolve();
    });

    await mkdir(join(DATA_DIR, "uploads"), { recursive: true });

    models = await ModelRuntime.create();

    const registry = createRegistry();
    const cwd = process.cwd();

    registry.install(CodingTools);

    extensions = new Extensions({
        notify: (notice) => {
            for (const client of clients) {
                send(client, { type: "extension-notice", session: client.session, notice });
            }
        },
        contextWindow: windowOf,
        resolveModelAuth: async (providerId, signal) =>
            (await models.getAuth(providerId, { signal }))?.auth,
        registerModelProvider: (native) => {
            models.registerNativeProvider(native);

            return () => {
                // A reload registers the next version before this one's disposers run, and those
                // must not take the provider that is in force now.
                if (models.getRegisteredNativeProvider(native.id) === native) {
                    models.unregisterProvider(native.id);
                }
            };
        },
        sessionRequest: sessionRequestOf,
        sessionTitle: sessionTitleOf,
        sessionName: sessionNameOf,
        setSessionTitle: setSessionTitleOf,
        readDoc: readDocOf,
        sessionListChanged: listChanged,
        sessionChanged: changes.notify,
        registry,
        dir: join(cwd, "extensions"),
        cwd,
        dataDir: DATA_DIR,
        log: (message) => {
            console.log(message);
        },
    });
    lifecycle.onStop(() => extensions.dispose());
    await extensions.load();
    extensions.watch();

    const storage = await openNodeSqliteStorage(join(DATA_DIR, "state.sqlite"));

    runtime = shapeModelRequests(
        models,
        () => extensions.requestShapers,
        () => extensions.fetchWrappers,
    );

    try {
        harness = await Harness.open(
            storage,
            {
                models: runtime,
                registry,
                settings: { stream: STREAM },
                env: () => new NodeExecutionEnv({ cwd }),
                onReport: (error, info) => {
                    if (info.type === "session_failed") {
                        console.error("pi-durable-agent: storage session failed", error);
                    }
                },
            },
            context,
        );
    } catch (error) {
        await storage.close(context);

        throw error;
    }

    lifecycle.onStop(() => harness.close(context));

    const root = await harness.root(context, {
        agent: {
            model: { provider, modelId },
            cwd,
            thinkingLevel: supportedLevel(models, { provider, modelId }, "off"),
        },
    });

    rootId = Number(root.id);
    sessions = new Sessions({ harness, model: { provider, modelId }, models, context });
    extensions.onChange(() => {
        for (const { opened, view } of latest.values()) {
            publish(opened, view);
        }
    });

    const stopObserving = observeNewConversations(harness, (id) => {
        attach(id).catch((error: unknown) => {
            console.error(error);
        });
    });

    // The harness dispatches nothing until `resume()`. Every conversation gets its observer, and the
    // extensions get their baseline views, first; so work that was cut off by a restart and finishes
    // at once is seen as a change, with no browser attached.
    for (const id of await sessions.ids()) {
        await attach(Number(id));
    }

    routes = [
        ...conversationRoutes({ sessions, attach, rootId: () => rootId, harness, stream }),
        ...sessionRoutes({
            sessions,
            attach,
            list: sessionRows,
            watch: watchList,
        }),
        ...modelRoutes({ models, sessions, fallback: { provider, modelId } }),
        ...fileRoutes({ dataDir: DATA_DIR }),
        ...extensionRoutes({ extensions, attach, ownerOf: sessionOwnerOf }),
        {
            // The app's restart button; 409 without the supervisor, which would leave nothing to start it.
            method: "POST",
            path: /^\/api\/restart$/,
            handle: (_request, response) => {
                if (!SUPERVISED) {
                    answer(response, 409, {
                        error: "start it with pnpm serve or pnpm start to restart it from the app",
                    });

                    return;
                }

                answer(response, 200, { ok: true });
                setTimeout(() => {
                    stop(RESTART_CODE);
                }, 100);
            },
        },
        {
            method: "GET",
            path: /^\/api\/health$/,
            handle: (_request, response) => {
                answer(response, 200, {
                    ok: true,
                    model: MODEL,
                    cwd: process.cwd(),
                    home: homedir(),
                    session: rootId,
                });
            },
        },
    ];

    lifecycle.onStop(() => {
        stopObserving();

        return Promise.resolve();
    });
    harness.resume();
}

let stopping = false;

function stop(code: number): void {
    if (stopping) {
        return;
    }

    stopping = true;
    // A tool or model stream that ignores its abort must not hold the restart forever; the lock
    // goes with the process.
    const limit = new Promise<void>((done) => {
        setTimeout(done, STOP_LIMIT_MS);
    });

    void Promise.race([lifecycle.stop(), limit]).then(
        () => {
            process.exit(code);
        },
        (error: unknown) => {
            console.error(error);
            process.exit(1);
        },
    );
}

async function main(): Promise<void> {
    lifecycle = await listen({
        dataDir: DATA_DIR,
        port: PORT,
        handle,
    });

    try {
        await boot();
    } catch (error) {
        await lifecycle.stop().catch((stopError: unknown) => {
            console.error(stopError);
        });

        throw error;
    }

    lifecycle.ready();
    process.on("SIGINT", () => {
        stop(0);
    });
    process.on("SIGTERM", () => {
        stop(0);
    });
    console.log(`pi-durable-agent: http://127.0.0.1:${PORT} · ${MODEL}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
