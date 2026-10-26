/**
 * From the harness's committed view to the browser's contract — the only translation layer. Everything
 * the browser draws comes through here, and every value is narrowed rather than trusted: a document is
 * JSON that a much older version of this file may have written.
 */

import type { EntryRecord } from "@earendil-works/pi-durable";

import type {
    ClientAnswerStats,
    ClientBlock,
    ClientEntry,
    ClientLive,
    ClientQueued,
    ClientTool,
    ClientUsage,
} from "../shared/protocol.ts";

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

function numberAt(record: Record<string, unknown> | undefined, key: string): number {
    const value = record?.[key];

    return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function optionalNumber(
    record: Record<string, unknown> | undefined,
    key: string,
): number | undefined {
    const value = record?.[key];

    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Undefined for a message too old to carry a start time: its line would say nothing true. */
function statsOf(message: Record<string, unknown> | undefined): ClientAnswerStats | undefined {
    const startedAt = optionalNumber(message, "timestamp");

    if (startedAt === undefined) {
        return undefined;
    }

    const usage = recordOf(message?.["usage"]);
    const thinkingLevel =
        stringOf(message, "thinkingLevel") ?? stringOf(message, "providerThinkingLevel");
    const durationMs = optionalNumber(message, "durationMs");

    return {
        model: stringOf(message, "model") ?? "",
        stopReason: stringOf(message, "stopReason") ?? "stop",
        input:
            numberAt(usage, "input") + numberAt(usage, "cacheRead") + numberAt(usage, "cacheWrite"),
        output: numberAt(usage, "output"),
        cost: numberAt(recordOf(usage?.["cost"]), "total"),
        startedAt,
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
        ...(durationMs === undefined ? {} : { durationMs }),
    };
}

/** Diff lines a card shows before it says the rest is cut. */
const DIFF_LINES = 400;

/** An edit's display diff, cut by whole lines: a cut line would read as a change. */
function diffOf(details: Record<string, unknown> | undefined): string | undefined {
    const diff = stringOf(details, "diff");

    if (diff === undefined || diff === "") {
        return undefined;
    }

    const lines = diff.split("\n");

    return lines.length <= DIFF_LINES
        ? diff
        : [
              ...lines.slice(0, DIFF_LINES),
              ` … ${String(lines.length - DIFF_LINES)} more lines`,
          ].join("\n");
}

/** One entry for the browser, or `undefined` for bookkeeping the screen never shows. */
export function projectEntry(entry: EntryRecord): ClientEntry | undefined {
    const id = Number(entry.id);
    const message = recordOf(Array.isArray(entry.model) ? entry.model[0] : undefined);

    switch (entry.kind) {
        case "pi.user": {
            const at = optionalNumber(message, "timestamp");

            return {
                id,
                kind: "user",
                text: textOf(message?.["content"]),
                ...(at === undefined ? {} : { at }),
            };
        }

        case "pi.assistant": {
            const model = stringOf(message, "model");
            const error = stringOf(message, "errorMessage");
            const stats = statsOf(message);

            return {
                id,
                kind: "assistant",
                blocks: blocksOf(message?.["content"]),
                ...(model === undefined ? {} : { model }),
                ...(error === undefined ? {} : { error }),
                ...(stats === undefined ? {} : { stats }),
            };
        }

        case "pi.tool-result": {
            const output = textOf(message?.["content"]);
            const cut = output.length > OUTPUT_LIMIT;
            const at = optionalNumber(message, "timestamp");
            const durationMs = optionalNumber(message, "durationMs");
            const diff = diffOf(recordOf(message?.["details"]));

            return {
                id,
                kind: "toolResult",
                callId: labelOf(message?.["toolCallId"], ""),
                name: labelOf(message?.["toolName"], "?"),
                text: cut ? `${output.slice(0, OUTPUT_LIMIT)}\n…` : output,
                isError: message?.["isError"] === true,
                ...(cut ? { truncated: true } : {}),
                ...(at === undefined ? {} : { at }),
                ...(durationMs === undefined ? {} : { durationMs }),
                ...(diff === undefined ? {} : { diff }),
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

/** Spend so far: every model and tool bucket of `pi.usage`, added up. */
export function projectUsage(value: unknown): ClientUsage {
    const usage = recordOf(value);
    const total: ClientUsage = { input: 0, output: 0, cost: 0 };

    for (const bucket of ["models", "tools"]) {
        const group = recordOf(usage?.[bucket]);

        if (group === undefined) {
            continue;
        }

        for (const raw of Object.values(group)) {
            const entry = recordOf(raw);
            const cost = recordOf(entry?.["cost"]);

            total.input += numberAt(entry, "input");
            total.output += numberAt(entry, "output");
            total.cost += numberAt(cost, "total");
        }
    }

    return total;
}

/** Messages waiting in `pi.inbox`. Writes are not messages; they never reach the screen. */
function queuedOf(value: unknown): ClientQueued[] {
    const items = recordOf(value)?.["items"];
    const queued: ClientQueued[] = [];

    if (!Array.isArray(items)) {
        return queued;
    }

    for (const raw of items) {
        const item = recordOf(raw);
        const mode = stringOf(item, "mode");
        const id = numberAt(item, "id");

        if (id !== 0 && (mode === "steer" || mode === "followUp")) {
            queued.push({ id, mode, text: textOf(item?.["content"]) });
        }
    }

    return queued;
}

export function projectLive(value: unknown, usage: unknown, inbox: unknown): ClientLive {
    const live = recordOf(value);
    const queued = queuedOf(inbox);
    const out: ClientLive = { busy: live?.["run"] !== undefined, usage: projectUsage(usage) };

    if (queued.length > 0) {
        out.queued = queued;
    }

    if (live === undefined) {
        return out;
    }

    const generation = recordOf(live["generation"]);
    const message = recordOf(generation?.["message"]);

    if (message !== undefined) {
        const startedAt = optionalNumber(message, "timestamp");

        out.blocks = blocksOf(message["content"]);

        if (startedAt !== undefined) {
            out.startedAt = startedAt;
        }
    }

    if (live["tools"] !== undefined) {
        out.tools = toolsOf(live["tools"]);
    }

    return out;
}
