/**
 * The whole server: conversations, one event stream each, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    type Conversation,
    type ConversationId,
    createRegistry,
    Harness,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type { ClientEntry, ClientLive, ServerEvent } from "../shared/protocol.ts";
import { commitAnnouncer } from "./commit-announcer.ts";
import { Extensions, type SessionRequest } from "./extensions.ts";
import { hasOlder } from "./history.ts";
import { answer, type Route } from "./http.ts";
import { shapeModelRequests } from "./model-requests.ts";
import { projectEntry, projectLive } from "./projection.ts";
import { conversationRoutes } from "./routes/conversation.ts";
import { extensionRoutes } from "./routes/extensions.ts";
import { fileRoutes } from "./routes/files.ts";
import { modelRoutes } from "./routes/models.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { knownHost, sameOrigin } from "./same-origin.ts";
import { type Opened, Sessions, supportedLevel } from "./sessions.ts";
import { serveStatic } from "./static.ts";

type View = Awaited<ReturnType<Conversation["viewState"]>>["value"];

const context = BACKGROUND_CONTEXT;
const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = join(process.cwd(), "data");
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
const IDLE_HEARTBEAT_MS = 20_000;
/**
 * The hour-long provider cache, for every conversation and for the requests extensions send on top
 * of one (keep-warm renews it). A short cache is gone before a ping can renew it, so the two agree.
 */
const STREAM = { cacheRetention: "long" } as const;

type Client = { response: ServerResponse; session: number };

const clients = new Set<Client>();
const busy = new Map<number, boolean>();
const endedAt = new Map<number, number>();
const latest = new Map<number, { opened: Opened; view: View }>();

let models: ModelRuntime;
let runtime: ModelRuntime;
let extensions: Extensions;
let sessions: Sessions;
let harness: Harness;
let rootId: number;
let routes: Route[] = [];

function send(client: Client, event: ServerEvent): void {
    client.response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: ServerEvent): void {
    for (const client of clients) {
        if (client.session === event.session) {
            send(client, event);
        }
    }
}

function entriesOf(view: View): ClientEntry[] {
    return view.entries
        .map(projectEntry)
        .filter((entry): entry is ClientEntry => entry !== undefined);
}

function windowOf(provider: string, modelId: string): number | undefined {
    return models.getModels().find((model) => model.provider === provider && model.id === modelId)
        ?.contextWindow;
}

/**
 * One conversation's next request, for an extension that must reuse its cache and add nothing: the
 * context the next request would send, and a request on top through the same model runtime, so the
 * installed fetch wrappers shape both.
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

    return {
        model: ref,
        messages,
        send: (next, signal) =>
            runtime
                .streamSimple(
                    model,
                    { messages: [...next] },
                    {
                        ...STREAM,
                        signal,
                        ...(agent.thinkingLevel === "off"
                            ? {}
                            : { reasoning: agent.thinkingLevel }),
                    },
                )
                .result(),
    };
}

function liveOf(view: View): ClientLive {
    const live = projectLive(view.docs["pi.live"], view.docs["pi.usage"], view.docs["pi.inbox"]);
    const status = extensions.statuses({
        entries: view.entries,
        contextWindow: windowOf,
    });

    return status.length === 0 ? live : { ...live, status };
}

/** Sends what changed since the last commit: only new entries when nothing was rewritten. */
function publish(opened: Opened, view: View): void {
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

    const live = liveOf(view);

    latest.set(opened.id, { opened, view });
    if (busy.get(opened.id) === true && !live.busy) {
        endedAt.set(opened.id, Date.now());
    }

    busy.set(opened.id, live.busy);
    broadcast({ type: "live", session: opened.id, live });
}

const announce = commitAnnouncer({
    cwdOf: async (id) => {
        const agent = await latest.get(id)?.opened.conversation.agent(context);

        return agent?.cwd ?? null;
    },
    publish: (view) => {
        extensions.publish(view);
    },
});

/** Sends a state to the browsers and, with its busy value as it is now, to the extensions. */
function observe(opened: Opened, state: View): void {
    publish(opened, state);
    void announce(opened.id, state.entries, busy.get(opened.id) === true);
}

/** Opens a conversation and starts forwarding its commits. */
async function attach(id: number): Promise<Opened | undefined> {
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

/** Starts the event stream of a session: the whole state first, then every change. */
async function stream(response: ServerResponse, opened: Opened): Promise<void> {
    const view = await opened.conversation.viewState(context);
    const id = Number(opened.id);

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

    const entries = entriesOf(view.value);
    const first = entries[0];

    send(client, {
        type: "hello",
        session: id,
        entries,
        live: liveOf(view.value),
        model: MODEL,
        more:
            first === undefined
                ? false
                : await hasOlder({ conversation: opened.conversation, context, id: first.id }),
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

            return;
        }
    }

    answer(response, 404, { error: "not found" });
}

async function main(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

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
        sessionRequest: sessionRequestOf,
        registry,
        dir: join(cwd, "extensions"),
        cwd,
        dataDir: DATA_DIR,
        log: (message) => {
            console.log(message);
        },
    });
    await extensions.load();
    extensions.watch();

    const storage = await openNodeSqliteStorage(join(DATA_DIR, "state.sqlite"));

    runtime = shapeModelRequests(
        models,
        () => extensions.requestShapers,
        () => extensions.fetchWrappers,
    );
    harness = await Harness.open(
        storage,
        {
            models: runtime,
            registry,
            settings: { stream: STREAM },
            env: () => new NodeExecutionEnv({ cwd }),
        },
        context,
    );

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
            busy: (id) => busy.get(id) === true,
            endedAt: (id) => endedAt.get(id),
        }),
        ...modelRoutes({ models, sessions, fallback: { provider, modelId } }),
        ...fileRoutes({ dataDir: DATA_DIR }),
        ...extensionRoutes({ extensions, attach }),
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

    harness.resume();

    const server = createServer((request, response) => {
        handle(request, response).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "the request failed";

            if (!response.headersSent) {
                answer(response, 500, { error: message });
            } else {
                response.end();
            }
        });
    });

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            client.response.write(": heartbeat\n\n");
        }
    }, IDLE_HEARTBEAT_MS);

    const stop = (): void => {
        clearInterval(heartbeat);
        void extensions
            .dispose()
            .then(() => harness.close(context))
            .then(() => {
                server.close();
                process.exit(0);
            });
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    server.listen(PORT, "127.0.0.1", () => {
        console.log(`pi-durable-agent: http://127.0.0.1:${PORT} · ${MODEL}`);
    });
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
