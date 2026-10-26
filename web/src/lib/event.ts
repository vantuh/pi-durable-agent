import type {
    ClientBlock,
    ClientEntry,
    ClientLive,
    ClientTool,
    ClientUsage,
    ServerEvent,
} from "../../../shared/protocol.ts";

function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

function str(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function blocks(value: unknown): ClientBlock[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const out: ClientBlock[] = [];

    for (const raw of value) {
        const block = record(raw);
        const type = block?.["type"];
        const body = str(block?.["text"]) ?? "";

        if (type === "text" && body !== "") {
            out.push({ type: "text", text: body });
        } else if (type === "thinking" && body !== "") {
            out.push({ type: "thinking", text: body });
        } else if (type === "toolCall") {
            out.push({
                type: "toolCall",
                id: str(block?.["id"]) ?? "",
                name: str(block?.["name"]) ?? "?",
                args: block?.["args"] ?? null,
            });
        }
    }

    return out;
}

function tools(value: unknown): ClientTool[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const out: ClientTool[] = [];

    for (const raw of value) {
        const tool = record(raw);
        const callId = str(tool?.["callId"]);
        const name = str(tool?.["name"]);
        const status = str(tool?.["status"]);
        const output = str(tool?.["output"]);

        if (callId === undefined || name === undefined) {
            continue;
        }

        out.push({
            callId,
            name,
            status: status === "running" ? "running" : status === "done" ? "done" : "pending",
            ...(output === undefined ? {} : { output }),
        });
    }

    return out;
}

function usage(value: unknown): ClientUsage {
    const sum = record(value);

    return {
        input: num(sum?.["input"]) ?? 0,
        output: num(sum?.["output"]) ?? 0,
        cost: num(sum?.["cost"]) ?? 0,
    };
}

function live(value: unknown): ClientLive {
    const state = record(value);
    const out: ClientLive = { busy: state?.["busy"] === true, usage: usage(state?.["usage"]) };
    const streamed = blocks(state?.["blocks"]);

    if (streamed.length > 0) {
        out.blocks = streamed;
    }

    const running = tools(state?.["tools"]);

    if (running.length > 0) {
        out.tools = running;
    }

    return out;
}

function entry(value: unknown): ClientEntry | undefined {
    const raw = record(value);
    const id = num(raw?.["id"]);
    const kind = raw?.["kind"];

    if (id === undefined) {
        return undefined;
    }

    if (kind === "user") {
        return { id, kind: "user", text: str(raw?.["text"]) ?? "" };
    }

    if (kind === "assistant") {
        const model = str(raw?.["model"]);
        const error = str(raw?.["error"]);

        return {
            id,
            kind: "assistant",
            blocks: blocks(raw?.["blocks"]),
            ...(model === undefined ? {} : { model }),
            ...(error === undefined ? {} : { error }),
        };
    }

    if (kind === "toolResult") {
        return {
            id,
            kind: "toolResult",
            callId: str(raw?.["callId"]) ?? "",
            name: str(raw?.["name"]) ?? "?",
            text: str(raw?.["text"]) ?? "",
            isError: raw?.["isError"] === true,
        };
    }

    if (kind === "other") {
        return { id, kind: "other", entryKind: str(raw?.["entryKind"]) ?? "?" };
    }

    return undefined;
}

function entries(value: unknown): ClientEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const out: ClientEntry[] = [];

    for (const raw of value) {
        const parsed = entry(raw);

        if (parsed !== undefined) {
            out.push(parsed);
        }
    }

    return out;
}

/**
 * One event from the stream, or `undefined` for anything this version cannot read. Every field is
 * copied by name, so a server that grew a field cannot break the page.
 */
export function parseEvent(raw: string): ServerEvent | undefined {
    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }

    const event = record(value);
    const type = event?.["type"];
    const session = num(event?.["session"]);

    if (session === undefined) {
        return undefined;
    }

    if (type === "hello") {
        return {
            session,
            type: "hello",
            entries: entries(event?.["entries"]),
            live: live(event?.["live"]),
            model: str(event?.["model"]) ?? "",
        };
    }

    if (type === "entries") {
        return {
            session,
            type: "entries",
            entries: entries(event?.["entries"]),
            replace: event?.["replace"] === true,
        };
    }

    if (type === "live") {
        return { session, type: "live", live: live(event?.["live"]) };
    }

    if (type === "error") {
        return { session, type: "error", message: str(event?.["message"]) ?? "the run failed" };
    }

    return undefined;
}
