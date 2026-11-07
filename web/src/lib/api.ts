import { hc, type InferResponseType } from "hono/client";

import type { AppType } from "../../../server/app-type.ts";
import type { FolderLayout } from "../../../shared/folders.ts";
import { recordOf } from "../../../shared/guards.ts";
import type {
    ClientHistory,
    CommandResult,
    DefaultModel,
    ExtensionNotice,
    ModelChoice,
    SendMode,
    SessionSummary,
    SessionsEvent,
} from "../../../shared/protocol.ts";
import { parseHistory } from "./event.ts";

const client = hc<AppType>("/");

export type Health = InferResponseType<typeof client.api.health.$get, 200>;

export type UploadedFile = InferResponseType<typeof client.api.files.$post, 201>;

export type FolderPage = InferResponseType<typeof client.api.fs.$get, 200>;

function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/** The answer of a route when it succeeded; any other status throws `/path?query: status`. */
async function ok<R extends { ok: boolean; status: number; url: string }>(
    pending: Promise<R>,
): Promise<Exclude<R, { ok: false }>> {
    const response = await pending;

    if (!isOk(response)) {
        const { pathname, search } = new URL(response.url);

        throw new Error(`${pathname}${search}: ${String(response.status)}`);
    }

    return response;
}

function isOk<R extends { ok: boolean }>(response: R): response is Exclude<R, { ok: false }> {
    return response.ok;
}

export async function getHealth(): Promise<Health | undefined> {
    try {
        return await (await ok(client.api.health.$get())).json();
    } catch {
        return undefined;
    }
}

/** Where the session list streams from; an `EventSource` takes the path as it is. */
export function sessionsStreamPath(): string {
    return client.api.sessions.events.$path();
}

export async function listSessions(): Promise<SessionSummary[]> {
    return sessionsOf(await (await ok(client.api.sessions.$get())).json());
}

/** The rows of a list answer or of a `sessions` event; both carry them as `sessions`. */
export function sessionsOf(value: unknown): SessionSummary[] {
    return rowsOf(recordOf(value)?.["sessions"]);
}

/**
 * One frame of the list stream: the whole list, the rows that changed since the last frame with the ids that are
 * gone, or a session's own notice. Anything else is read as a whole list, which replaces whatever the screen holds.
 */
export function sessionsEventOf(value: unknown): SessionsEvent {
    const body = recordOf(value);

    if (body?.["type"] === "extension-notice") {
        const notice = noticeOf(body["notice"]);

        // A notice this version cannot read changes no row.
        return notice === undefined
            ? { type: "rows", rows: [], gone: [] }
            : { type: "extension-notice", notice };
    }

    if (body?.["type"] !== "rows") {
        return { type: "sessions", sessions: rowsOf(body?.["sessions"]) };
    }

    return {
        type: "rows",
        rows: rowsOf(body["rows"]),
        gone: list(body["gone"]).filter((id): id is number => typeof id === "number"),
    };
}

function noticeOf(value: unknown): ExtensionNotice | undefined {
    const notice = recordOf(value);
    const level = notice?.["level"];
    const message = notice?.["message"];

    if ((level !== "success" && level !== "error") || typeof message !== "string") {
        return undefined;
    }

    return {
        level,
        message,
        ...(typeof notice?.["session"] === "number" ? { session: notice["session"] } : {}),
        ...(typeof notice?.["description"] === "string"
            ? { description: notice["description"] }
            : {}),
    };
}

function rowsOf(value: unknown): SessionSummary[] {
    const rows: SessionSummary[] = [];

    for (const raw of list(value)) {
        const row = recordOf(raw);
        const id = num(row?.["id"], 0);

        if (id === 0) {
            continue;
        }

        rows.push({
            id,
            name: typeof row?.["name"] === "string" ? row["name"] : null,
            title: typeof row?.["title"] === "string" ? row["title"] : null,
            cwd: typeof row?.["cwd"] === "string" ? row["cwd"] : null,
            model: typeof row?.["model"] === "string" ? row["model"] : null,
            thinkingLevel: typeof row?.["thinkingLevel"] === "string" ? row["thinkingLevel"] : null,
            busy: row?.["busy"] === true,
            ...(typeof row?.["mark"] === "string" ? { mark: row["mark"] } : {}),
            ...(typeof row?.["under"] === "string" ? { under: row["under"] } : {}),
            archived: row?.["archived"] === true,
            activeAt: typeof row?.["activeAt"] === "number" ? row["activeAt"] : null,
            unseen: row?.["unseen"] === true,
            ...(typeof row?.["parent"] === "number" ? { parent: row["parent"] } : {}),
            ...(typeof row?.["endedAt"] === "number" ? { endedAt: row["endedAt"] } : {}),
        });
    }

    return rows;
}

export async function setSessionArchived(session: number, archived: boolean): Promise<void> {
    await ok(client.api.sessions.archive.$post({ json: { session, archived } }));
}

export async function setSessionTitle(session: number, title: string): Promise<void> {
    await ok(client.api.sessions.title.$post({ json: { session, title } }));
}

export async function markSeen(session: number): Promise<void> {
    await ok(client.api.sessions.seen.$post({ json: { session } }));
}

/** Out of the sidebar for good: only a note says it is deleted, the transcript stays on disk. */
export async function deleteSession(session: number): Promise<void> {
    await ok(client.api.sessions.delete.$post({ json: { session } }));
}

export async function createSession(cwd: string): Promise<number> {
    return (await (await ok(client.api.sessions.$post({ json: { cwd } }))).json()).session;
}

/** Older entries, older than `before`: the start of a conversation the event stream no longer carries. */
export async function fetchHistory(
    session: number,
    before: number,
): Promise<ClientHistory | undefined> {
    const response = await ok(
        client.api.history.$get({ query: { session: String(session), before: String(before) } }),
    );

    return parseHistory(await response.json());
}

export type SkillInfo = InferResponseType<typeof client.api.skills.$get, 200>["skills"][number];

/** The skills a session can run with `/skill:name`. */
export async function listSkills(session: number): Promise<SkillInfo[]> {
    const response = await ok(client.api.skills.$get({ query: { session: String(session) } }));

    return (await response.json()).skills;
}

/** The files of the session's folder, as paths relative to it. */
export async function listProjectFiles(session: number): Promise<string[]> {
    const response = await ok(
        client.api["project-files"].$get({ query: { session: String(session) } }),
    );

    return (await response.json()).files;
}

export async function getFavourites(): Promise<string[]> {
    return (await (await ok(client.api.favourites.$get())).json()).folders;
}

export async function setFavourites(folders: string[]): Promise<void> {
    await ok(client.api.favourites.$put({ json: { folders } }));
}

export async function getFolderLayout(): Promise<FolderLayout> {
    return (await (await ok(client.api["folder-layout"].$get())).json()) satisfies FolderLayout;
}

export async function setFolderLayout(layout: FolderLayout): Promise<void> {
    await ok(client.api["folder-layout"].$put({ json: layout }));
}

type ServedModels = InferResponseType<typeof client.api.models.$get, 200>;

/** What the server answers, except that the screen starts with no default before the first answer. */
export type Models = Omit<ServedModels, "default"> & { default: ServedModels["default"] | null };

export async function listModels(): Promise<Models> {
    return (await ok(client.api.models.$get())).json();
}

export async function setDefaultModel(choice: DefaultModel): Promise<void> {
    await ok(
        client.api.default.$post({
            json: {
                model: { provider: choice.provider, modelId: choice.modelId },
                thinkingLevel: choice.thinkingLevel,
            },
        }),
    );
}

export async function addScopedModel(choice: ModelChoice): Promise<void> {
    await ok(client.api.scoped.$post({ json: { provider: choice.provider, modelId: choice.id } }));
}

export async function removeScopedModel(choice: ModelChoice): Promise<void> {
    await ok(
        client.api.scoped.$delete({ json: { provider: choice.provider, modelId: choice.id } }),
    );
}

export async function setAgent(
    session: number,
    change: { model?: { provider: string; modelId: string }; thinkingLevel?: string },
): Promise<void> {
    await ok(client.api.agent.$post({ json: { session, ...change } }));
}

/** Where a conversation streams from; an `EventSource` takes the path as it is. */
export function conversationStreamPath(session: number): string {
    return client.api.events.$path({ query: { session: String(session) } });
}

/** Where the picture an entry's tool call returned is served from, for an `img`'s `src`. */
export function entryImageUrl(session: number, entry: number, index: number): string {
    return client.api["entry-image"].$path({
        query: { session: String(session), entry: String(entry), index: String(index) },
    });
}

/**
 * Runs a slash command. `empty` says it had nothing to do, so the screen can say so; a failure throws with the
 * server's message.
 */
export async function runCommand(
    session: number,
    name: string,
    args: string,
): Promise<CommandResult["status"]> {
    const response = await client.api.commands.$post({ json: { session, name, args } });

    if (!response.ok) {
        const refusal = await response.json().catch(() => undefined);

        throw new Error(refusal?.error ?? `/api/commands: ${String(response.status)}`);
    }

    return (await response.json()).status;
}

export async function sendMessage(
    session: number,
    text: string,
    files: string[],
    mode?: SendMode,
): Promise<boolean> {
    const response = await client.api.messages.$post({
        json: { session, text, files, ...(mode === undefined ? {} : { mode }) },
    });

    return response.ok;
}

/** Takes a waiting message out of `pi.inbox`; answers where it got to, or `undefined` when the call failed. */
export async function withdrawQueued(
    session: number,
    id: number,
): Promise<"aborted" | "already_placed" | "settled" | "not_found" | undefined> {
    try {
        return (
            await (await ok(client.api.queued.withdraw.$post({ json: { session, id } }))).json()
        ).result;
    } catch {
        return undefined;
    }
}

export async function stopRun(session: number): Promise<void> {
    await client.api.abort.$post({ json: { session } });
}

/** Asks the supervisor for a new server process; the event stream reconnects on its own. */
export async function restartServer(): Promise<void> {
    await ok(client.api.restart.$post());
}

/** Rebuilds `dist/` in place; the next reload loads the new shell. `log` is Vite's failure output. */
export async function rebuildShell(): Promise<{ ok: boolean; log: string }> {
    return (await ok(client.api.build.$post())).json();
}

/** Where an uploaded file can be read back, as an image's `src`. */
export function uploadUrl(path: string): string {
    return client.api.uploads.$path({ query: { path } });
}

/** The bytes go as the body, as they are; the name travels in a header because a body has no room for it. */
export async function uploadFile(file: File): Promise<UploadedFile | undefined> {
    try {
        const response = await client.api.files.$post(undefined, {
            headers: { "x-filename": encodeURIComponent(file.name) },
            init: { body: file },
        });

        return response.ok ? await response.json() : undefined;
    } catch {
        return undefined;
    }
}

export async function listFolders(path: string, hidden: boolean): Promise<FolderPage | undefined> {
    try {
        return await (
            await ok(client.api.fs.$get({ query: { path, hidden: hidden ? "1" : "0" } }))
        ).json();
    } catch {
        return undefined;
    }
}

export type ExtensionInfo = InferResponseType<
    typeof client.api.extensions.$get,
    200
>["extensions"][number];

export async function listExtensions(): Promise<ExtensionInfo[]> {
    return (await (await ok(client.api.extensions.$get())).json()).extensions;
}

/** Throws an `Error` with the server's message when the change is refused. */
export async function setExtensionEnabled(name: string, enabled: boolean): Promise<ExtensionInfo> {
    // `hc` puts a path parameter in as it is, and a folder name may hold anything.
    const response = await client.api.extensions[":name"].$put({
        param: { name: encodeURIComponent(name) },
        json: { enabled },
    });

    if (!response.ok) {
        const refusal = await response.json().catch(() => undefined);

        throw new Error(refusal?.error ?? String(response.status));
    }

    return response.json();
}
