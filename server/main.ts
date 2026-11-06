/**
 * The whole server: conversations, one event stream each, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Gzip } from "node:zlib";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    type Conversation,
    type ConversationId,
    createRegistry,
    Harness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";

import { messageOf } from "../shared/guards.ts";
import type {
    ClientBlock,
    ClientEntry,
    ClientLive,
    ClientQueued,
    ClientStatus,
    ServerEvent,
    SessionSummary,
    SessionsEvent,
} from "../shared/protocol.ts";
import { buildShell } from "./build.ts";
import { commitView } from "./commit-view.ts";
import { executionEnv } from "./execution-env.ts";
import { type SessionPrompt, Extensions, type SessionRequest } from "./extensions.ts";
import { hasOlder } from "./history.ts";
import {
    type ApiEnv,
    openEventStream,
    RESPONSE_ALREADY_SENT,
    routeFailed,
    writeEvent,
} from "./http.ts";
import { type Lifecycle, listen } from "./lifecycle.ts";
import { blocksSince, listSince } from "./live-delta.ts";
import { liveWindow } from "./live-window.ts";
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
import { SessionList } from "./session-list.ts";
import { sessionPromptOf as renderSessionPrompt } from "./session-prompt.ts";
import { type Opened, Sessions, supportedLevel } from "./sessions.ts";
import { serveStatic } from "./static.ts";

type View = Awaited<ReturnType<Conversation["viewState"]>>["value"];

const context = BACKGROUND_CONTEXT;
const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = resolve(process.env["PI_DURABLE_DATA_DIR"] ?? join(process.cwd(), "data"));
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
// A phone radio that wakes every 20 s never rests; 45 s still stays under the usual proxy idle timeouts.
const IDLE_HEARTBEAT_MS = 45_000;
/**
 * The bytes one `hello` carries, newest entries first: opening a session should show the last turns, not
 * wait for its whole history. The server answers in milliseconds, so what a phone on a slow link waits for
 * is the transfer: 128 KB is about a second at 1 Mbit/s and about 35 KB gzipped, and anything older is one
 * `/api/history` page away, which the transcript asks for when it scrolls up.
 */
const HELLO_BYTES = 128 * 1024;
/** A burst of changes (a run ending writes several) is sent as one frame. */
const LIST_DELAY_MS = 100;
/**
 * A row whose change nobody marked would stay stale for ever. Every so often the whole list is read again and
 * diffed, so a path that forgets to name its session costs a delay, not a wrong row.
 */
const RECONCILE_MS = 30_000;
/** A child that commits all the time makes its parent's browsers ask again once per this long. */
const CHANGE_WINDOW_MS = 250;
/**
 * A commit lands about every 100 ms while an answer streams, and each one used to send a whole frame to every
 * browser. One frame per window is four a second, the same window `CHANGE_WINDOW_MS` gives extension-notified
 * changes, so both sources of a live frame behave alike.
 */
const LIVE_FRAME_MS = 250;
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

/** One open stream: the response, and the gzip stream its events go through for a client that takes one. */
type EventStream = { response: ServerResponse; gzip: Gzip | undefined };
type Client = EventStream & {
    session: number;
    /** The blocks of the streamed answer this client holds, so a live frame carries only what it lacks. */
    held: ClientBlock[];
    /** The waiting messages this client holds: a live frame repeats them only when they changed. */
    heldQueued: ClientQueued[];
    /** The extension status fields this client holds, for the same reason. */
    heldStatus: ClientStatus[];
};

const clients = new Set<Client>();
const listWatchers = new Set<EventStream>();
const busy = new Map<number, boolean>();
const latest = new Map<number, { opened: Opened; view: View }>();
const liveFrames = liveWindow({
    windowMs: LIVE_FRAME_MS,
    send: sendLive,
});
const changes = sessionChanges({
    windowMs: CHANGE_WINDOW_MS,
    changed: (id) => {
        liveFrames.changed(id);
    },
});
let listQueued = false;
let listChain: Promise<void> = Promise.resolve();
let reconcile: ReturnType<typeof setInterval> | undefined;

let models: ModelRuntime;
let runtime: ModelRuntime;
let extensions: Extensions;
let sessions: Sessions;
let list: SessionList;
let harness: Harness;
let lifecycle: Lifecycle;
let rootId: number;

function send(client: Client, event: ServerEvent): void {
    writeEvent(client.response, `data: ${JSON.stringify(event)}\n\n`, client.gzip);
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

/** Whether the session's own run is busy, or a session started from it, at any depth, is. */
async function sessionWorking(session: number): Promise<boolean> {
    if (isBusy(session)) {
        return true;
    }

    for (const [id, running] of busy) {
        let owner = running ? await sessions.owner(idOf(id)) : undefined;
        // Stops a cycle in the records from looping.
        const visited = new Set([id]);

        while (owner !== undefined && !visited.has(owner)) {
            if (owner === session) {
                return true;
            }

            visited.add(owner);
            owner = await sessions.owner(idOf(owner));
        }
    }

    return false;
}

/** What extensions say about a session's row: the mark they put on it and the folder it is shown under. */
async function markRow(row: SessionSummary): Promise<SessionSummary> {
    const mark = extensions.markOf(row.id);
    const under = row.cwd === null ? undefined : await extensions.groupOf(row.cwd);

    return {
        ...row,
        ...(mark === undefined ? {} : { mark }),
        ...(under === undefined ? {} : { under }),
    };
}

/** The rows the browser reads, marked by the extensions; one list, one place. */
async function sessionRows(): Promise<SessionSummary[]> {
    return Promise.all((await sessions.list(isBusy)).map(markRow));
}

/** One row, as the browser reads it: what a change that names its session costs, instead of the whole list. */
async function markedRow(id: number): Promise<SessionSummary | undefined> {
    const row = await sessions.row(idOf(id), isBusy(id));

    return row === undefined ? undefined : markRow(row);
}

/** One frame, written once for every watcher: one `writeEvent` per frame, so the gzip stream flushes it as it is. */
function sendFrame(watchers: Iterable<EventStream>, event: SessionsEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;

    for (const watcher of watchers) {
        writeEvent(watcher.response, data, watcher.gzip);
    }
}

/**
 * One send after another: a watcher's whole list always comes before any frame of changes it would lack, and an
 * older frame never lands after a newer one.
 */
function queueListSend(task: () => Promise<void>): Promise<void> {
    const sent = listChain.then(task);

    listChain = sent.catch((error: unknown) => {
        console.error(error);
    });

    return listChain;
}

/**
 * Sends what changed to every list stream, once per burst. An id names the session the change touched, so only
 * its row is read again; a change that names none, and the periodic reconcile, read the whole list.
 */
function listChanged(id?: number): void {
    if (listWatchers.size === 0) {
        return;
    }

    list.changed(id);

    if (listQueued) {
        return;
    }

    listQueued = true;
    void queueListSend(flushList);
}

async function flushList(): Promise<void> {
    await delay(LIST_DELAY_MS);
    listQueued = false;

    const frame = await list.flush();

    if (frame !== undefined) {
        sendFrame(listWatchers, { type: "rows", rows: frame.rows, gone: frame.gone });
    }
}

/** Read again only while someone is watching: the list nobody reads needs no reconciling. */
function watchReconcile(): void {
    reconcile ??= setInterval(() => {
        listChanged();
    }, RECONCILE_MS);
}

function unwatchReconcile(): void {
    if (listWatchers.size > 0 || reconcile === undefined) {
        return;
    }

    clearInterval(reconcile);
    reconcile = undefined;
}

/** The session list stream: the whole list now, then the rows that changed after every change. */
async function watchList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const watcher: EventStream = { response, gzip: openEventStream(request, response) };

    response.on("close", () => {
        listWatchers.delete(watcher);
        unwatchReconcile();
    });
    // Queued like every flush, so no frame of changes this watcher lacks can be diffed before the list it starts from.
    await queueListSend(async () => {
        listWatchers.add(watcher);
        watchReconcile();
        sendFrame([watcher], { type: "sessions", sessions: await list.whole() });
    });
}

function entriesOf(view: View): ClientEntry[] {
    return view.entries.map(projectEntry);
}

/** The newest entries one `hello` carries, and whether older ones were left out of the view. */
type HelloPage = { entries: ClientEntry[]; cut: boolean };

/**
 * The newest entries that fit `HELLO_BYTES`. The newest entry is always carried, so one huge entry
 * cannot open an empty session.
 */
function helloPage(entries: readonly ClientEntry[]): HelloPage {
    let bytes = 0;
    let start = entries.length;

    for (const entry of entries.toReversed()) {
        const size = JSON.stringify(entry).length;

        if (bytes + size > HELLO_BYTES && start < entries.length) {
            break;
        }

        bytes += size;
        start -= 1;
    }

    return { entries: entries.slice(start), cut: start > 0 };
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

/**
 * A session id as the harness brands it. The brand lives only in the type, and every id here came
 * from the harness or from a JSON number, so this is the one place the two are taken for the same.
 */
function idOf(session: number): ConversationId {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id is a number at run time; the brand lives only in the type
    return session as ConversationId;
}

/**
 * One conversation's next request, for an extension that reuses its cache, and one request on top: the
 * context the next request would send, and a request through the same model runtime, so the installed
 * fetch wrappers shape both. The request sends the messages it is given, the conversation's or its own.
 */
async function sessionRequestOf(session: number): Promise<SessionRequest | undefined> {
    const opened = await sessions.open(idOf(session));

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

/**
 * The system prompt and tools an empty session's first request will carry, rendered without writing an
 * entry or calling a model. Undefined once the session has entries.
 */
async function sessionPromptOf(session: number): Promise<SessionPrompt | undefined> {
    const opened = await sessions.open(idOf(session));

    if (opened === undefined) {
        return undefined;
    }

    return await renderSessionPrompt({
        conversation: opened.conversation,
        models: runtime,
        // The builder the Harness was opened with, so the sections see the same environment.
        env: executionEnv(process.cwd()),
        read: harness,
        report: (error, what) => {
            console.log(`session prompt: "${what}" failed: ${messageOf(error)}`);
        },
        context,
    });
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

/** The newest live state to every client of a session, each frame cut to what that client does not hold yet. */
function sendLive(id: number): void {
    const current = latest.get(id);

    if (current === undefined) {
        return;
    }

    const live = liveOf(id, current.view);

    for (const client of clients) {
        if (client.session === id) {
            const { blocks, queued, status, ...rest } = live;
            const changed = listSince(client.heldQueued, queued);
            const changedStatus = listSince(client.heldStatus, status);

            send(client, {
                type: "live",
                session: id,
                live: {
                    ...rest,
                    ...(blocks === undefined ? {} : { blocks: blocksSince(client.held, blocks) }),
                    ...(changed === undefined ? {} : { queued: changed }),
                    ...(changedStatus === undefined ? {} : { status: changedStatus }),
                },
            });
            client.held = blocks ?? [];
            client.heldQueued = queued ?? [];
            client.heldStatus = status ?? [];
        }
    }
}

/** Sends what changed since the last commit: only new entries when nothing was rewritten. */
function publish(opened: Opened, view: View): void {
    const live = liveOf(opened.id, view);
    const entries = entriesOf(view);
    const ids = entries.map((entry) => entry.id);
    const grows = ids.length > opened.sent.length && opened.sent.every((id, at) => id === ids[at]);
    const unchanged =
        ids.length === opened.sent.length && opened.sent.every((id, at) => id === ids[at]);
    // The one entry a row shows: the question that names the session. A row's time is when its newest run
    // started, which is not an entry: the entries a run appends change nothing in the list.
    const asked = entries.findIndex((entry) => entry.kind === "user" && entry.text.trim() !== "");
    const named = asked !== -1 && asked >= opened.sent.length;

    if (grows) {
        const fresh = entries.slice(opened.sent.length);

        opened.sent = ids;
        broadcast({ type: "entries", session: opened.id, entries: fresh });
    } else if (!unchanged) {
        opened.sent = ids;
        broadcast({ type: "entries", session: opened.id, entries });
    }

    // A run starting or ending moves the row's mark and its unseen state; a first question names it.
    if (named || isBusy(opened.id) !== live.busy) {
        listChanged(opened.id);
    }

    latest.set(opened.id, { opened, view });
    // A run's start is the row's time, whoever started it: a person's message touches the clock in its own
    // request, and a subagent, a report or a queued follow-up submits without one.
    if (live.busy && !isBusy(opened.id)) {
        void sessions.touch(opened.id).then(
            () => listChanged(opened.id),
            (error: unknown) => {
                console.error(error);
            },
        );
    }

    // Taken before the browsers hear of it, so a `seen` sent the moment it ends is later.
    if (busy.get(opened.id) === true && !live.busy) {
        // An unhandled rejection would end the process, and every conversation in it.
        void sessions.ended(opened.id, Date.now()).then(
            () => listChanged(opened.id),
            (error: unknown) => {
                console.error(error);
            },
        );
    }

    busy.set(opened.id, live.busy);

    // An entry that finishes the streamed answer comes with the frame that clears it, or the answer shows twice.
    if (!unchanged) {
        liveFrames.flush(opened.id);
    } else {
        liveFrames.changed(opened.id);
    }
}

/** Sends a state to the browsers and, with its busy value as it is now, to the extensions. */
function observe(opened: Opened, state: View): void {
    publish(opened, state);
    extensions.publish(commitView(state, busy.get(opened.id) === true));
}

const attaching = new Map<number, Promise<Opened | undefined>>();
/** The attached view of each session, so a deleted one stops feeding the server its state. */
const attached = new Map<number, () => void>();

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
    const opened = await sessions.open(idOf(id));

    if (opened === undefined) {
        return undefined;
    }

    if (opened.watched) {
        return opened;
    }

    const view = await opened.conversation.viewState(context);

    opened.watched = true;
    opened.sent = view.value.entries.map((entry) => Number(entry.id));
    attached.set(id, () => {
        view.dispose();
    });
    observe(opened, view.value);
    view.subscribe((state) => {
        observe(opened, state);
    });

    return opened;
}

/**
 * Drops everything the server holds for a session that is gone: its last state and busy mark, an open
 * still in flight, its attached view, and the state an extension is replayed after a reload. Without
 * this the extensions hear of it again on their next reload, and nothing can be sent to it any more.
 */
function detach(id: number): void {
    attached.get(id)?.();
    attached.delete(id);
    liveFrames.forget(id);
    latest.delete(id);
    busy.delete(id);
    attaching.delete(id);
    extensions.forget(id);
}

/**
 * Starts the event stream of a session: the newest page of the state first, then every change. The page is cut
 * from the state `publish` stored for the attached view, the same state the browsers were sent up to, so no
 * commit can reach this client ahead of the `hello` that already carries it; nothing may await from reading
 * that state to sending it, and the entries it left out are older history the transcript pages back.
 */
async function stream(
    request: IncomingMessage,
    response: ServerResponse,
    opened: Opened,
): Promise<void> {
    const id = Number(opened.id);
    const opening = helloPage(entriesOf(viewOf(id)));
    // A page cut from the view needs no read to know it has older entries: the ones it left out are older.
    let more = opening.cut;
    let first = opening.entries[0]?.id;

    // `hasOlder` reads through the conversation's line, where a commit can land ahead of it: its answer is
    // about the first entry it asked with, so ask again until that entry stays put.
    while (!more && first !== undefined) {
        more = await hasOlder({ conversation: opened.conversation, context, id: first });

        const now = firstEntryId(id);

        if (now === first) {
            break;
        }

        first = now;
    }

    // Read after the awaits: a commit that lands while `hasOlder` runs would reach no client at all.
    const view = viewOf(id);
    const page = helloPage(entriesOf(view));

    const live = liveOf(id, view);
    const client: Client = {
        response,
        gzip: openEventStream(request, response),
        session: id,
        held: live.blocks ?? [],
        heldQueued: live.queued ?? [],
        heldStatus: live.status ?? [],
    };

    clients.add(client);
    client.response.on("close", () => {
        clients.delete(client);
    });

    send(client, {
        type: "hello",
        session: id,
        entries: page.entries,
        live,
        model: MODEL,
        more: page.cut || more,
    });
}

/**
 * The only way in: the host gate, the built shell, the same-origin gate, then the routes. Every answer that is
 * JSON goes back through Hono; a stream, a file's bytes and an extension's own handler write the response and
 * say so.
 */
const app = new Hono<ApiEnv>();

app.notFound((c) => {
    // No route took the request, so the session list has nothing to refresh.
    c.set("unmatched", true);

    return c.json({ error: "not found" }, 404);
});

app.use("*", async (c, next) => {
    const { incoming, outgoing } = c.env;

    if (!knownHost(incoming.headers.host)) {
        return c.json({ error: "unknown host" }, 403);
    }

    if (!c.req.path.startsWith("/api/")) {
        await serveStatic(DIST, incoming, outgoing);

        return RESPONSE_ALREADY_SENT;
    }

    if (!sameOrigin(incoming.headers)) {
        return c.json({ error: "cross-origin requests are not allowed" }, 403);
    }

    // Hono answers HEAD from the GET route; before, only an extension's own HTTP took every method, and the
    // rest of the API is as unknown to HEAD as it was.
    if (c.req.method === "HEAD" && !c.req.path.startsWith("/api/extensions/")) {
        return c.json({ error: "not found" }, 404);
    }

    c.set("unmatched", false);

    return await next();
});

app.use("*", async (c, next) => {
    await next();

    // `onError` answers an exception and resolves `next()`: a route that threw changed nothing the list shows.
    if (c.get("unmatched") || c.error !== undefined) {
        return;
    }

    // An extension changes a row only through the host, which sends the list itself; a panel
    // that polls an action every second must not resend every row to every device.
    if (c.req.method !== "GET" && !c.req.path.startsWith("/api/extensions/")) {
        listChanged(c.get("changedSession"));
    }
});

app.onError(routeFailed);

/**
 * The whole surface: the gates, then every route. `boot` mounts it once the state the routes read exists, and
 * the listener serves this same instance, so this return type is the app's type, not a table of regexes.
 */
export function mountRoutes(deps: {
    conversation: Parameters<typeof conversationRoutes>[0];
    sessions: Parameters<typeof sessionRoutes>[0];
    models: Parameters<typeof modelRoutes>[0];
    files: Parameters<typeof fileRoutes>[0];
    extensions: Parameters<typeof extensionRoutes>[0];
}) {
    return app
        .route("/", conversationRoutes(deps.conversation))
        .route("/", sessionRoutes(deps.sessions))
        .route("/", modelRoutes(deps.models))
        .route("/", fileRoutes(deps.files))
        .route("/", extensionRoutes(deps.extensions))
        .post(
            // The app's rebuild button. The files are read from `dist/` per request, so the new
            // shell is in force without a restart; the answer comes when the build is over.
            "/api/build",
            async (c) => c.json(await buildShell()),
        )
        .post(
            // The app's restart button; 409 without the supervisor, which would leave nothing to start it.
            "/api/restart",
            (c) => {
                if (!SUPERVISED) {
                    return c.json(
                        {
                            error: "start it with pnpm serve or pnpm start to restart it from the app",
                        },
                        409,
                    );
                }

                setTimeout(() => {
                    stop(RESTART_CODE);
                }, 100);

                return c.json({ ok: true });
            },
        )
        .get("/api/health", (c) =>
            c.json({
                ok: true,
                model: MODEL,
                cwd: process.cwd(),
                home: homedir(),
                session: rootId,
            }),
        );
}

/** The mounted app the listener serves; `boot` fills it before anything is admitted. */
let mounted: ReturnType<typeof mountRoutes> | undefined;

/** Opens everything that touches storage. Runs once the lock and the port are ours. */
async function boot(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            writeEvent(client.response, ": heartbeat\n\n", client.gzip);
        }

        for (const watcher of listWatchers) {
            writeEvent(watcher.response, ": heartbeat\n\n", watcher.gzip);
        }
    }, IDLE_HEARTBEAT_MS);

    lifecycle.onStop(() => {
        clearInterval(heartbeat);
        changes.dispose();
        liveFrames.dispose();

        if (reconcile !== undefined) {
            clearInterval(reconcile);
            reconcile = undefined;
        }

        return Promise.resolve();
    });

    await mkdir(join(DATA_DIR, "uploads"), { recursive: true });

    models = await ModelRuntime.create();

    const registry = createRegistry();
    const cwd = process.cwd();

    registry.install(CodingTools);

    extensions = new Extensions({
        notify: (notice) => {
            // A session's own notice rides the list stream every tab holds, so a tab showing no session hears it too,
            // and no conversation stream says it twice. A notice about the app keeps to the conversation streams.
            if (notice.session !== undefined) {
                sendFrame(listWatchers, { type: "extension-notice", notice });

                return;
            }

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
        sessionPrompt: sessionPromptOf,
        sessionTitle: (session) => sessions.title(idOf(session)),
        sessionName: (session) => sessions.name(idOf(session)),
        sessionOwner: (session) => sessions.owner(idOf(session)),
        sessionSeen: (session) => sessions.seenSinceEnd(idOf(session)),
        sessionWorking,
        // The title lives in a document, so no commit carries it to the browsers: the list goes again.
        setSessionTitle: async (session, title) => {
            await sessions.setTitle(idOf(session), title);
            listChanged(session);
        },
        // The folder is in a document too, so no commit carries it to the browsers: the list goes again.
        setSessionCwd: async (session, folder) => {
            await sessions.setCwd(idOf(session), folder);
            listChanged(session);
        },
        readDoc: (doc, session) => sessions.readDoc(doc, idOf(session)),
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
                env: executionEnv(cwd),
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
    list = new SessionList({ rows: sessionRows, row: markedRow });
    extensions.onChange(() => {
        for (const { opened, view } of latest.values()) {
            publish(opened, view);
        }
    });

    const stopObserving = observeNewConversations(harness, (id) => {
        // A conversation nobody asked for is a new row, and no request of its own brings it to the list.
        listChanged();
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

    mounted = mountRoutes({
        conversation: { sessions, attach, rootId: () => rootId, harness, stream },
        sessions: { sessions, attach, detach, list: sessionRows, watch: watchList },
        models: { models, sessions, fallback: { provider, modelId } },
        files: { dataDir: DATA_DIR },
        extensions: {
            extensions,
            attach,
            ownerOf: (session) => sessions.owner(idOf(session)),
        },
    });

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
        // Nothing is admitted before `ready()`, and `boot` has mounted every route by then.
        handle: getRequestListener((request, env) =>
            mounted === undefined ? app.fetch(request, env) : mounted.fetch(request, env),
        ),
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
