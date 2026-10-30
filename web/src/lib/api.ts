import type {
    ClientHistory,
    CommandResult,
    DefaultModel,
    ModelChoice,
    SendMode,
    SessionSummary,
} from "../../../shared/protocol.ts";
import { parseHistory } from "./event.ts";

export type Health = {
    cwd: string;
    home: string;
};

export type UploadedFile = {
    path: string;
    name: string;
    size: number;
    mime: string | null;
};

export type FolderPage = {
    path: string;
    parent: string | null;
    home: string;
    dirs: { name: string; path: string }[];
};

function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

function str(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(path, init);

    if (!response.ok) {
        throw new Error(`${path}: ${String(response.status)}`);
    }

    return response.json();
}

export async function getHealth(): Promise<Health | undefined> {
    try {
        const body = record(await json("/api/health"));

        if (body === undefined) {
            return undefined;
        }

        return {
            cwd: str(body["cwd"], ""),
            home: str(body["home"], ""),
        };
    } catch {
        return undefined;
    }
}

export async function listSessions(): Promise<SessionSummary[]> {
    return sessionsOf(await json("/api/sessions"));
}

/** The rows of a list answer or of a `sessions` event; both carry them as `sessions`. */
export function sessionsOf(value: unknown): SessionSummary[] {
    const body = record(value);
    const rows: SessionSummary[] = [];

    for (const raw of list(body?.["sessions"])) {
        const row = record(raw);
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
    await json("/api/sessions/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, archived }),
    });
}

export async function setSessionTitle(session: number, title: string): Promise<void> {
    await json("/api/sessions/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, title }),
    });
}

export async function markSeen(session: number): Promise<void> {
    await json("/api/sessions/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
    });
}

/** Out of the sidebar for good: only a note says it is deleted, the transcript stays on disk. */
export async function deleteSession(session: number): Promise<void> {
    await json("/api/sessions/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
    });
}

export async function createSession(cwd: string): Promise<number> {
    const body = record(
        await json("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd }),
        }),
    );

    return num(body?.["session"], 0);
}

/** Older entries, older than `before`: the start of a conversation the event stream no longer carries. */
export async function fetchHistory(
    session: number,
    before: number,
): Promise<ClientHistory | undefined> {
    return parseHistory(
        await json(`/api/history?session=${String(session)}&before=${String(before)}`),
    );
}

export type SkillInfo = { name: string; description: string };

/** The skills a session can run with `/skill:name`. */
export async function listSkills(session: number): Promise<SkillInfo[]> {
    const body = record(await json(`/api/skills?session=${String(session)}`));

    return list(body?.["skills"]).flatMap((item) => {
        const skill = record(item);

        return skill === undefined
            ? []
            : [{ name: str(skill["name"], ""), description: str(skill["description"], "") }];
    });
}

/** The files of the session's folder, as paths relative to it. */
export async function listProjectFiles(session: number): Promise<string[]> {
    return list(
        record(await json(`/api/project-files?session=${String(session)}`))?.["files"],
    ).filter((path): path is string => typeof path === "string");
}

export async function getFavourites(): Promise<string[]> {
    return list(record(await json("/api/favourites"))?.["folders"]).filter(
        (entry): entry is string => typeof entry === "string",
    );
}

export async function setFavourites(folders: string[]): Promise<void> {
    await json("/api/favourites", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folders }),
    });
}

export type Models = {
    scoped: ModelChoice[];
    all: ModelChoice[];
    default: DefaultModel | null;
};

export async function listModels(): Promise<Models> {
    const body = record(await json("/api/models"));
    const stored = record(body?.["default"]);
    const provider = str(stored?.["provider"], "");
    const modelId = str(stored?.["modelId"], "");

    return {
        scoped: choices(body?.["scoped"]),
        all: choices(body?.["all"]),
        default:
            provider === "" || modelId === ""
                ? null
                : { provider, modelId, thinkingLevel: str(stored?.["thinkingLevel"], "off") },
    };
}

export async function setDefaultModel(choice: DefaultModel): Promise<void> {
    await json("/api/default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            model: { provider: choice.provider, modelId: choice.modelId },
            thinkingLevel: choice.thinkingLevel,
        }),
    });
}

export async function addScopedModel(choice: ModelChoice): Promise<void> {
    await json("/api/scoped", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice.provider, modelId: choice.id }),
    });
}

export async function removeScopedModel(choice: ModelChoice): Promise<void> {
    await json("/api/scoped", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice.provider, modelId: choice.id }),
    });
}

function choices(value: unknown): ModelChoice[] {
    const out: ModelChoice[] = [];

    for (const raw of list(value)) {
        const model = record(raw);
        const provider = str(model?.["provider"], "");
        const id = str(model?.["id"], "");

        if (provider === "" || id === "") {
            continue;
        }

        out.push({
            provider,
            id,
            name: str(model?.["name"], id),
            contextWindow: num(model?.["contextWindow"], 0),
            reasoning: model?.["reasoning"] === true,
            levels: list(model?.["levels"]).filter(
                (level): level is string => typeof level === "string",
            ),
        });
    }

    return out;
}

export async function setAgent(
    session: number,
    change: { model?: { provider: string; modelId: string }; thinkingLevel?: string },
): Promise<void> {
    await json("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, ...change }),
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
    const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, name, args }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const error: unknown =
        typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;

    if (!response.ok) {
        throw new Error(typeof error === "string" ? error : `/api/commands: ${response.status}`);
    }

    return typeof body === "object" && body !== null && Reflect.get(body, "status") === "empty"
        ? "empty"
        : "started";
}

export async function sendMessage(
    session: number,
    text: string,
    files: string[],
    mode?: SendMode,
): Promise<boolean> {
    const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, text, files, ...(mode === undefined ? {} : { mode }) }),
    });

    return response.ok;
}

/** Takes a waiting message out of `pi.inbox`; answers where it got to, or `undefined` when the call failed. */
export async function withdrawQueued(
    session: number,
    id: number,
): Promise<"aborted" | "already_placed" | "settled" | "not_found" | undefined> {
    try {
        const body = record(
            await json("/api/queued/withdraw", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ session, id }),
            }),
        );
        const result = body?.["result"];

        return result === "aborted" ||
            result === "already_placed" ||
            result === "settled" ||
            result === "not_found"
            ? result
            : undefined;
    } catch {
        return undefined;
    }
}

export async function stopRun(session: number): Promise<void> {
    await fetch("/api/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
    });
}

/** Asks the supervisor for a new server process; the event stream reconnects on its own. */
export async function restartServer(): Promise<void> {
    await json("/api/restart", { method: "POST" });
}

export async function uploadFile(file: File): Promise<UploadedFile | undefined> {
    try {
        const response = await fetch("/api/files", {
            method: "POST",
            headers: { "x-filename": encodeURIComponent(file.name) },
            body: file,
        });

        if (!response.ok) {
            return undefined;
        }

        const body = record(await response.json());
        const path = str(body?.["path"], "");

        if (path === "") {
            return undefined;
        }

        return {
            path,
            name: str(body?.["name"], file.name),
            size: num(body?.["size"], file.size),
            mime: typeof body?.["mime"] === "string" ? body["mime"] : null,
        };
    } catch {
        return undefined;
    }
}

export async function listFolders(path: string, hidden: boolean): Promise<FolderPage | undefined> {
    try {
        const query = new URLSearchParams({ path, hidden: hidden ? "1" : "0" });
        const body = record(await json(`/api/fs?${query.toString()}`));
        const dirs: { name: string; path: string }[] = [];

        for (const raw of list(body?.["dirs"])) {
            const dir = record(raw);
            const name = str(dir?.["name"], "");
            const full = str(dir?.["path"], "");

            if (name !== "" && full !== "") {
                dirs.push({ name, path: full });
            }
        }

        return {
            path: str(body?.["path"], path),
            parent: typeof body?.["parent"] === "string" ? body["parent"] : null,
            home: str(body?.["home"], ""),
            dirs,
        };
    } catch {
        return undefined;
    }
}

export type ExtensionInfo = {
    name: string;
    title: string;
    description: string;
    enabled: boolean;
    installed: boolean;
    error?: string;
};

function extensionInfo(value: unknown): ExtensionInfo | undefined {
    const row = record(value);
    const name = str(row?.["name"], "");

    if (row === undefined || name === "" || typeof row["enabled"] !== "boolean") {
        return undefined;
    }

    const error = row["error"];

    return {
        name,
        title: str(row["title"], name),
        description: str(row["description"], ""),
        enabled: row["enabled"],
        installed: row["installed"] === true,
        ...(typeof error === "string" ? { error } : {}),
    };
}

export async function listExtensions(): Promise<ExtensionInfo[]> {
    const body = record(await json("/api/extensions"));

    return list(body?.["extensions"]).flatMap((raw) => extensionInfo(raw) ?? []);
}

/** Throws an `Error` with the server's message when the change is refused. */
export async function setExtensionEnabled(name: string, enabled: boolean): Promise<ExtensionInfo> {
    const response = await fetch(`/api/extensions/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
    });
    const body = record(await response.json().catch(() => undefined));

    if (!response.ok) {
        throw new Error(str(body?.["error"], String(response.status)));
    }

    const info = extensionInfo(body);

    if (info === undefined) {
        throw new Error("the server sent an answer that is not an extension");
    }

    return info;
}
