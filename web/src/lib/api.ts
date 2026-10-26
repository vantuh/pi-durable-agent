import type {
    ClientUsage,
    DefaultModel,
    ModelChoice,
    SendMode,
    SessionSummary,
} from "../../../shared/protocol.ts";

export type Health = {
    model: string;
    cwd: string;
    home: string;
    session: number;
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
            model: str(body["model"], ""),
            cwd: str(body["cwd"], ""),
            home: str(body["home"], ""),
            session: num(body["session"], 0),
        };
    } catch {
        return undefined;
    }
}

export async function listSessions(): Promise<SessionSummary[]> {
    const body = record(await json("/api/sessions"));
    const rows: SessionSummary[] = [];

    for (const raw of list(body?.["sessions"])) {
        const row = record(raw);
        const id = num(row?.["id"], 0);

        if (id === 0) {
            continue;
        }

        rows.push({
            id,
            title: typeof row?.["title"] === "string" ? row["title"] : null,
            cwd: typeof row?.["cwd"] === "string" ? row["cwd"] : null,
            model: typeof row?.["model"] === "string" ? row["model"] : null,
            thinkingLevel: typeof row?.["thinkingLevel"] === "string" ? row["thinkingLevel"] : null,
            busy: row?.["busy"] === true,
            archived: row?.["archived"] === true,
            activeAt: typeof row?.["activeAt"] === "number" ? row["activeAt"] : null,
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

export async function stopRun(session: number): Promise<void> {
    await fetch("/api/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
    });
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

export type { ClientUsage };

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
