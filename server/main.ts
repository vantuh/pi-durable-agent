/**
 * The whole server: conversations, one event stream each, one way in. Small on purpose — features become
 * extensions, and the core grows only when it must.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

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
import { extensionHttpAllowed } from "./extension-http.ts";
import { ActionError, ActionNotFound, Extensions, parseActionBody } from "./extensions.ts";
import { shapeModelRequests } from "./model-requests.ts";
import { projectEntry, projectLive } from "./projection.ts";
import { type Opened, Sessions, THINKING_LEVELS } from "./sessions.ts";
import { expandSkillCommand, skillsFor } from "./skills.ts";
import { serveStatic } from "./static.ts";

async function readFavourites(): Promise<string[]> {
    try {
        const parsed: unknown = JSON.parse(await readFile(FAVOURITES_FILE, "utf8"));

        return Array.isArray(parsed)
            ? parsed.filter((entry): entry is string => typeof entry === "string")
            : [];
    } catch {
        return [];
    }
}

async function enabledModels(): Promise<string[] | undefined> {
    try {
        const raw = await readFile(join(homedir(), ".pi/agent/settings.json"), "utf8");
        const parsed: unknown = JSON.parse(raw);
        const list =
            typeof parsed === "object" && parsed !== null && "enabledModels" in parsed
                ? parsed.enabledModels
                : undefined;

        return Array.isArray(list)
            ? list.filter((entry): entry is string => typeof entry === "string")
            : undefined;
    } catch {
        return undefined;
    }
}

type View = Awaited<ReturnType<Conversation["viewState"]>>["value"];
type Content = Extract<Parameters<Conversation["submit"]>[0], { type: "input" }>["content"];

const IMAGE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
};

const context = BACKGROUND_CONTEXT;
const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env["PORT"] ?? 8788);
const DATA_DIR = join(process.cwd(), "data");
const UPLOAD_DIR = join(DATA_DIR, "uploads");
const FAVOURITES_FILE = join(DATA_DIR, "favourites.json");
const MODEL = process.env["MODEL"] ?? "openai/gpt-6.1-sol";
const MAX_BODY = 100_000_000;
const IDLE_HEARTBEAT_MS = 20_000;

type Client = { response: ServerResponse; session: number };

const clients = new Set<Client>();
const busy = new Map<number, boolean>();
const endedAt = new Map<number, number>();
const latest = new Map<number, { opened: Opened; view: View }>();

let models: ModelRuntime;
let extensions: Extensions;
let sessions: Sessions;
let harness: Harness;
let rootId: number;

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

async function body(request: IncomingMessage): Promise<unknown> {
    return new Promise((done, reject) => {
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
            const text = Buffer.concat(chunks).toString("utf8");

            if (text === "") {
                done(undefined);

                return;
            }

            try {
                done(JSON.parse(text));
            } catch {
                reject(new Error("body is not JSON"));
            }
        });
        request.on("error", reject);
    });
}

function bytes(request: IncomingMessage): Promise<Buffer> {
    return new Promise((done, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > MAX_BODY) {
                request.destroy();
                reject(new Error("file is too large"));

                return;
            }

            chunks.push(chunk);
        });
        request.on("end", () => {
            done(Buffer.concat(chunks));
        });
        request.on("error", reject);
    });
}

function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

function string(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function sessionOf(url: URL): number {
    const raw = Number(url.searchParams.get("session"));

    return Number.isFinite(raw) && raw > 0 ? raw : rootId;
}

function answer(response: ServerResponse, status: number, payload: unknown): void {
    let text: string;
    let code = status;

    try {
        text = JSON.stringify(payload);
    } catch (error) {
        code = 500;
        text = JSON.stringify({
            error: error instanceof Error ? error.message : "the result is not JSON",
        });
    }

    response.writeHead(code, { "content-type": "application/json" });
    response.end(text);
}

function contentOf(files: readonly string[], text: string): Promise<Content> {
    return (async () => {
        const images: { type: "image"; data: string; mimeType: string }[] = [];
        const mentioned: string[] = [];

        for (const file of files) {
            const mime = IMAGE_TYPES[extname(file).toLowerCase()];

            if (mime === undefined) {
                mentioned.push(file);

                continue;
            }

            images.push({
                type: "image",
                data: (await readFile(file)).toString("base64"),
                mimeType: mime,
            });
        }

        const said = mentioned.reduce((whole, file) => `${whole}\n\nAttached file: ${file}`, text);

        return [{ type: "text", text: said }, ...images];
    })();
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/events") {
        const id = sessionOf(url);
        const opened = await attach(id);

        if (opened === undefined) {
            answer(response, 404, { error: "no such session" });

            return;
        }

        const view = await opened.conversation.viewState(context);

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
            entries: entriesOf(view.value),
            live: liveOf(view.value),
            model: MODEL,
        });

        return;
    }

    if (request.method === "POST" && url.pathname === "/api/messages") {
        const payload = record(await body(request));
        const text = string(payload?.["text"]) ?? "";
        const id = typeof payload?.["session"] === "number" ? payload["session"] : rootId;
        const opened = await attach(id);
        const files = Array.isArray(payload?.["files"])
            ? payload["files"].filter((file): file is string => typeof file === "string")
            : [];

        if (opened === undefined) {
            answer(response, 404, { error: "no such session" });

            return;
        }

        if (text.trim() === "" && files.length === 0) {
            answer(response, 400, { error: "text is required" });

            return;
        }

        const mode = string(payload?.["mode"]);
        // `/skill:name request` carries the skill's instructions; the screen keeps showing what was typed.
        const cwd = (await opened.conversation.agent(context))?.cwd ?? process.cwd();
        const expanded = text.startsWith("/skill:")
            ? expandSkillCommand(text, skillsFor(cwd))
            : text;

        if (mode === "interrupt") {
            await opened.conversation.abort(context);
        }

        await opened.conversation.submit(
            {
                type: "input",
                content: await contentOf(files, expanded),
                ...(files.length === 0 && expanded === text
                    ? {}
                    : {
                          entry: {
                              kind: "chat.user",
                              data: {
                                  text,
                                  files: await Promise.all(
                                      files.map(async (path) => ({
                                          path,
                                          name: basename(path).replace(/^\d+-/, ""),
                                          size: (await stat(path)).size,
                                          image:
                                              IMAGE_TYPES[extname(path).toLowerCase()] !==
                                              undefined,
                                      })),
                                  ),
                              },
                          },
                      }),
                ...(mode === "steer" || mode === "followUp" ? { whenBusy: mode } : {}),
            },
            context,
        );
        await sessions.touch(opened.id);
        answer(response, 202, { ok: true });

        return;
    }

    if (request.method === "POST" && url.pathname === "/api/abort") {
        const payload = record(await body(request));
        const id = typeof payload?.["session"] === "number" ? payload["session"] : rootId;
        const opened = await attach(id);

        if (opened !== undefined) {
            await opened.conversation.abort(context);
        }

        answer(response, 202, { ok: true });

        return;
    }

    if (url.pathname === "/api/sessions" && request.method === "GET") {
        const list = await sessions.list(
            (id) => busy.get(id) === true,
            (id) => endedAt.get(id),
        );

        answer(response, 200, { sessions: list });
        return;
    }

    if (url.pathname === "/api/sessions" && request.method === "POST") {
        const payload = record(await body(request));
        const cwd = string(payload?.["cwd"]);
        const conversation = await sessions.create(cwd ?? process.cwd());

        await attach(Number(conversation.id));
        answer(response, 201, { session: Number(conversation.id) });

        return;
    }

    if (url.pathname === "/api/sessions/archive" && request.method === "POST") {
        const payload = record(await body(request));
        const id = payload?.["session"];
        const archived = payload?.["archived"];

        if (
            typeof id !== "number" ||
            !Number.isSafeInteger(id) ||
            id <= 0 ||
            typeof archived !== "boolean"
        ) {
            answer(response, 400, { error: "Expected a session id and archived boolean" });
            return;
        }

        const opened = await attach(id);

        if (opened === undefined) {
            answer(response, 404, { error: "Session not found" });
            return;
        }

        await sessions.setArchived(opened.id, archived);
        answer(response, 200, { ok: true });
        return;
    }

    if (url.pathname === "/api/sessions/title" && request.method === "POST") {
        const payload = record(await body(request));
        const id = payload?.["session"];
        const title = payload?.["title"];

        if (
            typeof id !== "number" ||
            !Number.isSafeInteger(id) ||
            id <= 0 ||
            typeof title !== "string"
        ) {
            answer(response, 400, { error: "Expected a session id and a title string" });
            return;
        }

        const opened = await attach(id);

        if (opened === undefined) {
            answer(response, 404, { error: "Session not found" });
            return;
        }

        await sessions.setTitle(opened.id, title.trim().slice(0, 80));
        answer(response, 200, { ok: true });
        return;
    }

    if (url.pathname === "/api/agent" && request.method === "POST") {
        const payload = record(await body(request));
        const id = typeof payload?.["session"] === "number" ? payload["session"] : rootId;
        const opened = await attach(id);
        const model = record(payload?.["model"]);
        const provider = string(model?.["provider"]);
        const modelId = string(model?.["modelId"]);
        const level = string(payload?.["thinkingLevel"]);
        const thinkingLevel = THINKING_LEVELS.find((known) => known === level);

        if (opened === undefined) {
            answer(response, 404, { error: "no such session" });

            return;
        }

        await opened.conversation.configure(
            {
                ...(provider === undefined || modelId === undefined
                    ? {}
                    : { model: { provider, modelId } }),
                ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
            },
            context,
        );
        answer(response, 202, { ok: true });

        return;
    }

    if (url.pathname === "/api/favourites" && request.method === "GET") {
        answer(response, 200, { folders: await readFavourites() });

        return;
    }

    if (url.pathname === "/api/favourites" && request.method === "PUT") {
        const raw = record(await body(request))?.["folders"];
        const folders = Array.isArray(raw)
            ? raw.filter((entry): entry is string => typeof entry === "string")
            : [];

        await writeFile(FAVOURITES_FILE, JSON.stringify(folders));
        answer(response, 200, { folders });

        return;
    }

    if (url.pathname === "/api/skills" && request.method === "GET") {
        const id = Number(url.searchParams.get("session"));
        const opened = await attach(Number.isInteger(id) ? id : rootId);
        const cwd = (await opened?.conversation.agent(context))?.cwd ?? process.cwd();

        answer(response, 200, {
            skills: skillsFor(cwd).map((skill) => ({
                name: skill.name,
                description: skill.description,
            })),
        });

        return;
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
        const available = await models.getAvailable();
        const list = models.getModels();
        const enabled = await enabledModels();
        const scoped =
            enabled === undefined
                ? available
                : available.filter((model) => {
                      const key = `${model.provider}/${model.id}`;

                      return enabled.some(
                          (entry) =>
                              entry === key || entry.slice(0, entry.lastIndexOf(":")) === key,
                      );
                  });

        const stored = await sessions.defaults();
        const [fallbackProvider = "", ...fallbackId] = MODEL.split("/");

        answer(response, 200, {
            scoped: scoped.map(modelInfo),
            all: list.map(modelInfo),
            default:
                stored === undefined
                    ? {
                          provider: fallbackProvider,
                          modelId: fallbackId.join("/"),
                          thinkingLevel: "off",
                      }
                    : { ...stored.model, thinkingLevel: stored.thinkingLevel },
        });

        return;
    }

    if (url.pathname === "/api/default" && request.method === "POST") {
        const payload = record(await body(request));
        const model = record(payload?.["model"]);
        const provider = string(model?.["provider"]);
        const modelId = string(model?.["modelId"]);
        const thinkingLevel = THINKING_LEVELS.find((known) => known === payload?.["thinkingLevel"]);

        if (provider === undefined || modelId === undefined || thinkingLevel === undefined) {
            answer(response, 400, { error: "model and thinkingLevel are required" });

            return;
        }

        await sessions.setDefaults({ provider, modelId }, thinkingLevel);
        answer(response, 200, { provider, modelId, thinkingLevel });

        return;
    }

    if (url.pathname === "/api/files" && request.method === "POST") {
        const raw = request.headers["x-filename"];
        const name = basename(decodeURIComponent(typeof raw === "string" ? raw : "file"));
        const saved = join(UPLOAD_DIR, `${String(Date.now())}-${name}`);
        const data = await bytes(request);

        await writeFile(saved, data);
        answer(response, 201, {
            path: saved,
            name,
            size: data.length,
            mime: IMAGE_TYPES[extname(name).toLowerCase()] ?? null,
        });

        return;
    }

    if (url.pathname === "/api/fs" && request.method === "GET") {
        const wanted = url.searchParams.get("path") ?? homedir();
        const path = resolve(wanted.startsWith("~") ? join(homedir(), wanted.slice(1)) : wanted);
        const hidden = url.searchParams.get("hidden") === "1";

        try {
            const { readdir } = await import("node:fs/promises");
            const entries = await readdir(path, { withFileTypes: true });
            const dirs = entries
                .filter((entry) => entry.isDirectory())
                .filter((entry) => hidden || !entry.name.startsWith("."))
                .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
                .sort((left, right) => left.name.localeCompare(right.name));

            answer(response, 200, {
                path,
                parent: path === "/" ? null : resolve(path, ".."),
                home: homedir(),
                dirs,
            });
        } catch {
            answer(response, 400, { error: "cannot read that folder" });
        }

        return;
    }

    if (url.pathname === "/api/uploads" && request.method === "GET") {
        const wanted = resolve(url.searchParams.get("path") ?? "");

        if (!wanted.startsWith(UPLOAD_DIR)) {
            answer(response, 403, { error: "not an uploaded file" });

            return;
        }

        try {
            const data = await readFile(wanted);

            response.writeHead(200, {
                "content-type":
                    IMAGE_TYPES[extname(wanted).toLowerCase()] ?? "application/octet-stream",
                "cache-control": "private, max-age=3600",
            });
            response.end(data);
        } catch {
            answer(response, 404, { error: "no such file" });
        }

        return;
    }

    const httpRoute = /^\/api\/extensions\/([^/]+)\/http(\/.*)$/.exec(url.pathname);
    if (httpRoute !== null) {
        // A raw handler must not become a cross-site proxy to a local process.
        if (!extensionHttpAllowed(request.headers)) {
            answer(response, 403, { error: "cross-origin extension HTTP is not allowed" });
            return;
        }
        try {
            await extensions.serveHttp(decodeURIComponent(httpRoute[1] ?? ""), {
                request,
                response,
                path: (httpRoute[2] ?? "/") + url.search,
            });
        } catch (error) {
            if (response.headersSent) {
                response.destroy();
            } else {
                answer(response, error instanceof ActionNotFound ? 404 : 500, {
                    error: error instanceof Error ? error.message : "extension HTTP failed",
                });
            }
        }
        return;
    }

    const actionRoute = /^\/api\/extensions\/([^/]+)\/actions\/([^/]+)$/.exec(url.pathname);

    if (request.method === "POST" && actionRoute !== null) {
        if (!extensionHttpAllowed(request.headers)) {
            answer(response, 403, { error: "cross-origin extension actions are not allowed" });
            return;
        }
        await runAction(request, response, actionRoute[1] ?? "", actionRoute[2] ?? "");

        return;
    }

    if (request.method === "GET" && url.pathname === "/api/extensions") {
        answer(response, 200, {
            installed: extensions.names,
            failed: extensions.failed,
            extensions: extensions.list,
        });
        return;
    }

    const toggleRoute = /^\/api\/extensions\/([^/]+)$/.exec(url.pathname);

    if (request.method === "PUT" && toggleRoute !== null) {
        await toggleExtension(request, response, toggleRoute[1] ?? "");

        return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
        answer(response, 200, {
            ok: true,
            model: MODEL,
            cwd: process.cwd(),
            home: homedir(),
            session: rootId,
        });

        return;
    }

    if (!url.pathname.startsWith("/api/")) {
        await serveStatic(DIST, request, response);

        return;
    }

    answer(response, 404, { error: "not found" });
}

/** 400 for a body that is not `{ enabled: boolean }`, 404 for an unknown folder. */
async function toggleExtension(
    request: IncomingMessage,
    response: ServerResponse,
    name: string,
): Promise<void> {
    try {
        const parsed: unknown = await body(request).catch(badBody);
        const enabled: unknown =
            typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
                ? Reflect.get(parsed, "enabled")
                : undefined;

        if (typeof enabled !== "boolean") {
            throw new ActionError("the body must be { enabled: boolean }");
        }

        answer(response, 200, await extensions.setEnabled(decodeURIComponent(name), enabled));
    } catch (error) {
        const message = error instanceof Error ? error.message : "the change failed";

        if (error instanceof ActionNotFound) {
            answer(response, 404, { error: message });
        } else if (error instanceof ActionError || error instanceof URIError) {
            answer(response, 400, { error: message });
        } else {
            answer(response, 500, { error: message });
        }
    }
}

/** 400 for bad input, 404 for an unknown extension, action or session, 500 for any other failure. */
async function runAction(
    request: IncomingMessage,
    response: ServerResponse,
    extension: string,
    action: string,
): Promise<void> {
    try {
        const parsed = parseActionBody(await body(request).catch(badBody));
        let session: { id: number; cwd: string | null } | null = null;

        if (parsed.session !== undefined) {
            const opened = await attach(parsed.session);

            if (opened === undefined) {
                answer(response, 404, { error: "no such session" });

                return;
            }

            const agent = await opened.conversation.agent(context);

            session = { id: parsed.session, cwd: agent.cwd ?? null };
        }

        const result = await extensions.call(
            decodeURIComponent(extension),
            decodeURIComponent(action),
            {
                args: parsed.args,
                session,
            },
        );

        answer(response, 200, { result });
    } catch (error) {
        const message = error instanceof Error ? error.message : "the action failed";

        if (error instanceof ActionNotFound) {
            answer(response, 404, { error: message });
        } else if (error instanceof ActionError || error instanceof URIError) {
            answer(response, 400, { error: message });
        } else {
            answer(response, 500, { error: message });
        }
    }
}

function badBody(error: unknown): never {
    throw new ActionError(error instanceof Error ? error.message : "the body is not valid");
}

function modelInfo(model: {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    reasoning: boolean;
}) {
    return {
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        levels: model.reasoning ? ["off", "low", "medium", "high", "max"] : ["off"],
    };
}

async function main(): Promise<void> {
    const [provider, modelId, ...rest] = MODEL.split("/");

    if (provider === undefined || modelId === undefined || rest.length > 0) {
        throw new Error(`MODEL must be "provider/modelId", not "${MODEL}"`);
    }

    const { mkdir } = await import("node:fs/promises");

    await mkdir(UPLOAD_DIR, { recursive: true });

    models = await ModelRuntime.create();

    const registry = createRegistry();
    const cwd = process.cwd();

    registry.install(CodingTools);

    extensions = new Extensions({
        contextWindow: windowOf,
        resolveModelAuth: async (providerId, signal) =>
            (await models.getAuth(providerId, { signal }))?.auth,
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

    harness = await Harness.open(
        storage,
        {
            models: shapeModelRequests(
                models,
                () => extensions.requestShapers,
                () => extensions.fetchWrappers,
            ),
            registry,
            env: () => new NodeExecutionEnv({ cwd }),
        },
        context,
    );

    const root = await harness.root(context, {
        agent: { model: { provider, modelId }, cwd },
    });

    rootId = Number(root.id);
    sessions = new Sessions({ harness, model: { provider, modelId }, cwd, context });
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
