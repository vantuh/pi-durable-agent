/**
 * The whole server: conversations, one event stream each, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { getRequestListener } from "@hono/node-server";

import { mountRoutes } from "./app.ts";
import { idOf } from "./conversation-id.ts";
import { executionEnv } from "./execution-env.ts";
import { extensionSessions } from "./extension-sessions.ts";
import { Extensions } from "./extensions/extensions.ts";
import { type Lifecycle, listen } from "./lifecycle.ts";
import { shapeModelRequests } from "./model-requests.ts";
import { observeNewConversations } from "./new-conversations.ts";
import { Sessions, supportedLevel } from "./sessions.ts";
import { conversationStream } from "./streams/conversation.ts";
import { IDLE_HEARTBEAT_MS } from "./streams/event-stream.ts";
import { sessionsStream } from "./streams/sessions.ts";

const context = BACKGROUND_CONTEXT;
const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = resolve(process.env["PI_DURABLE_DATA_DIR"] ?? join(process.cwd(), "data"));
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
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

let lifecycle: Lifecycle;

/** The mounted app the listener serves; `boot` fills it before anything is admitted. */
let mounted: ReturnType<typeof mountRoutes> | undefined;

/** Opens everything that touches storage. Runs once the lock and the port are ours. */
async function boot(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

    // The extensions' host calls back into the streams and the sessions, and the sessions open after the extensions
    // load: what a service needs that does not exist yet is read through a function when it is called.
    let harness: Harness;

    const windowOf = (providerId: string, id: string): number | undefined =>
        models.getModels().find((model) => model.provider === providerId && model.id === id)
            ?.contextWindow;
    const hostSessions = extensionSessions({
        sessions: () => sessions,
        runtime: () => runtime,
        harness: () => harness,
    });
    const conversations = conversationStream({
        sessions: () => sessions,
        extensions: () => extensions,
        contextWindow: windowOf,
        listChanged: (id) => {
            sessionStream.changed(id);
        },
        model: MODEL,
    });
    const sessionStream = sessionsStream({
        sessions: () => sessions,
        extensions: () => extensions,
        isBusy: conversations.isBusy,
    });

    const heartbeat = setInterval(() => {
        conversations.heartbeat();
        sessionStream.heartbeat();
    }, IDLE_HEARTBEAT_MS);

    lifecycle.onStop(() => {
        clearInterval(heartbeat);
        conversations.dispose();
        sessionStream.dispose();

        return Promise.resolve();
    });

    await mkdir(join(DATA_DIR, "uploads"), { recursive: true });

    const models = await ModelRuntime.create();

    const registry = createRegistry();
    const cwd = process.cwd();

    registry.install(CodingTools);

    const extensions = new Extensions({
        notify: (notice) => {
            // A session's own notice rides the list stream every tab holds, so a tab showing no session hears it too,
            // and no conversation stream says it twice. A notice about the app keeps to the conversation streams.
            if (notice.session !== undefined) {
                sessionStream.notice(notice);

                return;
            }

            conversations.notice(notice);
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
        sessionRequest: (session) => hostSessions.request(session),
        sessionPrompt: (session) => hostSessions.prompt(session),
        sessionContext: (session) => hostSessions.contextOf(session),
        sessionTitle: (session) => sessions.title(idOf(session)),
        sessionName: (session) => sessions.name(idOf(session)),
        sessionOwner: (session) => sessions.owner(idOf(session)),
        sessionSeen: (session) => sessions.seenSinceEnd(idOf(session)),
        sessionWorking: conversations.working,
        // The title lives in a document, so no commit carries it to the browsers: the list goes again.
        setSessionTitle: async (session, title) => {
            await sessions.setTitle(idOf(session), title);
            sessionStream.changed(session);
        },
        // The folder is in a document too, so no commit carries it to the browsers: the list goes again.
        setSessionCwd: async (session, folder) => {
            await sessions.setCwd(idOf(session), folder);
            sessionStream.changed(session);
        },
        readDoc: (doc, session) => sessions.readDoc(doc, idOf(session)),
        sessionListChanged: sessionStream.changed,
        sessionChanged: conversations.changed,
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

    const runtime = shapeModelRequests(
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
                onReport: (report) => {
                    if (report.kind === "storage_failed") {
                        console.error("pi-durable-agent: storage session failed", report.error);
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

    const rootId = Number(root.id);
    const sessions = new Sessions({ harness, model: { provider, modelId }, models, context });
    extensions.onChange(conversations.republish);

    const stopObserving = observeNewConversations(harness, (id) => {
        // A conversation nobody asked for is a new row, and no request of its own brings it to the list.
        sessionStream.changed();
        conversations.attach(id).catch((error: unknown) => {
            console.error(error);
        });
    });

    // The harness dispatches nothing until `resume()`. Every conversation gets its observer, and the
    // extensions get their baseline views, first; so work that was cut off by a restart and finishes
    // at once is seen as a change, with no browser attached.
    for (const id of await sessions.ids()) {
        await conversations.attach(Number(id));
    }

    mounted = mountRoutes({
        dist: DIST,
        listChanged: sessionStream.changed,
        model: MODEL,
        rootId: () => rootId,
        restart: SUPERVISED
            ? () => {
                  stop(RESTART_CODE);
              }
            : undefined,
        conversation: {
            sessions,
            attach: conversations.attach,
            rootId: () => rootId,
            harness,
            stream: conversations.stream,
        },
        sessions: {
            sessions,
            attach: conversations.attach,
            detach: conversations.detach,
            list: sessionStream.rows,
            watch: sessionStream.watch,
        },
        models: { models, sessions, fallback: { provider, modelId } },
        files: { dataDir: DATA_DIR },
        extensions: {
            extensions,
            attach: conversations.attach,
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
            mounted === undefined
                ? Response.json({ error: "starting" }, { status: 503 })
                : mounted.fetch(request, env),
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
