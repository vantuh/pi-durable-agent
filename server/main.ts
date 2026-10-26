/**
 * The whole server: one conversation, one event stream, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

import type { ClientEntry, ClientLive, ServerEvent } from "../shared/protocol.ts";
import { Extensions } from "./extensions.ts";
import { projectEntry, projectLive } from "./projection.ts";

type View = Awaited<ReturnType<Conversation["viewState"]>>["value"];

const context = BACKGROUND_CONTEXT;
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = join(process.cwd(), "data");
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
const MAX_BODY = 1_000_000;
const IDLE_HEARTBEAT_MS = 20_000;

const clients = new Set<ServerResponse>();

let sent: number[] = [];
let extensions: Extensions;
let root: Conversation;
let viewState: Awaited<ReturnType<Conversation["viewState"]>>;

function send(response: ServerResponse, event: ServerEvent): void {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: ServerEvent): void {
    for (const client of clients) {
        send(client, event);
    }
}

function entriesOf(view: View): ClientEntry[] {
    return view.entries
        .map(projectEntry)
        .filter((entry): entry is ClientEntry => entry !== undefined);
}

function liveOf(view: View): ClientLive {
    return projectLive(view.docs["pi.live"]);
}

/** Sends what changed since the last commit: only new entries when nothing was rewritten. */
function publish(view: View): void {
    const entries = entriesOf(view);
    const ids = entries.map((entry) => entry.id);
    const grows = ids.length > sent.length && sent.every((id, at) => id === ids[at]);
    const unchanged = ids.length === sent.length && ids.every((id, at) => id === sent[at]);

    if (grows) {
        const fresh = entries.slice(sent.length);

        sent = ids;
        broadcast({ type: "entries", entries: fresh, replace: false });
    } else if (!unchanged) {
        sent = ids;
        broadcast({ type: "entries", entries, replace: true });
    }

    broadcast({ type: "live", live: liveOf(view) });
}

function readBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > MAX_BODY) {
                request.destroy();
                reject(new Error("body is too large"));
                return;
            }

            chunks.push(chunk);
        });
        request.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("body is not JSON"));
            }
        });
        request.on("error", reject);
    });
}

function textOfBody(body: unknown): string | undefined {
    if (typeof body !== "object" || body === null || !("text" in body)) {
        return undefined;
    }

    const value: unknown = body.text;

    return typeof value === "string" ? value : undefined;
}

function answer(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/events") {
        const view = viewState.value;

        response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
        });
        clients.add(response);
        sent = view.entries.map((entry) => Number(entry.id));
        send(response, {
            type: "hello",
            entries: entriesOf(view),
            live: liveOf(view),
            model: MODEL,
        });
        request.on("close", () => {
            clients.delete(response);
        });

        return;
    }

    if (request.method === "POST" && url.pathname === "/api/messages") {
        const text = textOfBody(await readBody(request));

        if (text === undefined || text.trim() === "") {
            answer(response, 400, { error: "text is required" });
            return;
        }

        const submission = await root.submit({ type: "input", content: text }, context);

        answer(response, 202, { ok: true });
        void (async () => {
            const settled = await submission.wait(context);

            if (settled.status === "unanswered") {
                broadcast({ type: "error", message: settled.reason ?? "the run was not answered" });
            }
        })();

        return;
    }

    if (request.method === "GET" && url.pathname === "/api/extensions") {
        answer(response, 200, { installed: extensions.names, failed: extensions.failed });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
        answer(response, 200, { ok: true, model: MODEL, busy: liveOf(viewState.value).busy });
        return;
    }

    answer(response, 404, { error: "not found" });
}

async function main(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

    await mkdir(DATA_DIR, { recursive: true });

    const models = await ModelRuntime.create();
    const registry = createRegistry();
    const cwd = process.cwd();

    registry.install(CodingTools);

    extensions = new Extensions({
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
    const harness = await Harness.open(
        storage,
        {
            models,
            registry,
            env: () => new NodeExecutionEnv({ cwd }),
        },
        context,
    );

    root = await harness.root(context, { agent: { model: { provider, modelId }, cwd } });
    viewState = await root.viewState(context);
    viewState.subscribe((view) => {
        publish(view);
    });

    const server = createServer((request, response) => {
        handle(request, response).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "the request failed";

            if (!response.headersSent) {
                answer(response, 500, { error: message });
            } else {
                response.end();
            }

            broadcast({ type: "error", message });
        });
    });

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            client.write(": heartbeat\n\n");
        }
    }, IDLE_HEARTBEAT_MS);

    const stop = (): void => {
        clearInterval(heartbeat);
        void harness.close(context).then(() => {
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
