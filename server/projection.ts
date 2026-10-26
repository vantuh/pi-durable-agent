/**
 * From the harness's committed view to the browser's contract — the only translation layer. Everything
 * the browser draws comes through here, and every value is narrowed rather than trusted: a document is
 * JSON that a much older version of this file may have written.
 */

import type { EntryRecord } from "@earendil-works/pi-durable";

import type { ClientBlock, ClientEntry, ClientLive, ClientTool } from "../shared/protocol.ts";

/** Tool output reaches the browser cut; a tool that prints a megabyte must not close a socket. */
const OUTPUT_LIMIT = 4000;

/**
 * The one guarded door in the server: `unknown` in, a record out. Values are read by key and narrowed
 * again, so a document an older version wrote cannot crash the process.
 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof checked above; a record is read by key only
    return value as Record<string, unknown>;
}

function stringOf(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];

    return typeof value === "string" ? value : undefined;
}

function labelOf(value: unknown, fallback: string): string {
    if (typeof value === "string" && value !== "") {
        return value;
    }

    return typeof value === "number" ? String(value) : fallback;
}

function blocksOf(content: unknown): ClientBlock[] {
    const blocks: ClientBlock[] = [];

    if (!Array.isArray(content)) {
        return blocks;
    }

    for (const raw of content) {
        const part = recordOf(raw);
        const type = stringOf(part, "type");

        if (part === undefined) {
            continue;
        }

        if (type === "text") {
            const text = stringOf(part, "text") ?? "";

            if (text !== "") {
                blocks.push({ type: "text", text });
            }
        } else if (type === "thinking") {
            const text = stringOf(part, "thinking") ?? "";

            if (text.trim() !== "") {
                blocks.push({ type: "thinking", text });
            }
        } else if (type === "toolCall") {
            blocks.push({
                type: "toolCall",
                id: stringOf(part, "id") ?? "",
                name: stringOf(part, "name") ?? "?",
                args: part["arguments"] ?? {},
            });
        }
    }

    return blocks;
}

function textOf(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (!Array.isArray(content)) {
        return "";
    }

    let text = "";

    for (const raw of content) {
        const part = recordOf(raw);

        if (stringOf(part, "type") === "text") {
            text += stringOf(part, "text") ?? "";
        }
    }

    return text;
}

/** One entry for the browser, or `undefined` for bookkeeping the screen never shows. */
export function projectEntry(entry: EntryRecord): ClientEntry | undefined {
    const id = Number(entry.id);
    const message = recordOf(Array.isArray(entry.model) ? entry.model[0] : undefined);

    switch (entry.kind) {
        case "pi.user":
            return { id, kind: "user", text: textOf(message?.["content"]) };

        case "pi.assistant": {
            const model = stringOf(message, "model");
            const error = stringOf(message, "errorMessage");

            return {
                id,
                kind: "assistant",
                blocks: blocksOf(message?.["content"]),
                ...(model === undefined ? {} : { model }),
                ...(error === undefined ? {} : { error }),
            };
        }

        case "pi.tool-result": {
            const output = textOf(message?.["content"]);
            const cut = output.length > OUTPUT_LIMIT;

            return {
                id,
                kind: "toolResult",
                callId: labelOf(message?.["toolCallId"], ""),
                name: labelOf(message?.["toolName"], "?"),
                text: cut ? `${output.slice(0, OUTPUT_LIMIT)}\n…` : output,
                isError: message?.["isError"] === true,
                ...(cut ? { truncated: true } : {}),
            };
        }

        default:
            return { id, kind: "other", entryKind: entry.kind };
    }
}

function toolsOf(value: unknown): ClientTool[] {
    const tools: ClientTool[] = [];

    if (!Array.isArray(value)) {
        return tools;
    }

    for (const raw of value) {
        const slot = recordOf(raw);

        if (slot === undefined) {
            continue;
        }

        const callId = stringOf(slot, "callId");
        const name = stringOf(slot, "name");
        const status = stringOf(slot, "status");
        const output = stringOf(slot, "output");

        if (callId === undefined || name === undefined || status === undefined) {
            continue;
        }

        tools.push({
            callId,
            name,
            status: status === "running" ? "running" : status === "done" ? "done" : "pending",
            ...(output === undefined ? {} : { output }),
        });
    }

    return tools;
}

export function projectLive(value: unknown): ClientLive {
    const live = recordOf(value);

    if (live === undefined) {
        return { busy: false };
    }

    const out: ClientLive = { busy: live["run"] !== undefined };
    const generation = recordOf(live["generation"]);
    const message = recordOf(generation?.["message"]);

    if (message !== undefined) {
        out.blocks = blocksOf(message["content"]);
    }

    if (live["tools"] !== undefined) {
        out.tools = toolsOf(live["tools"]);
    }

    return out;
}
