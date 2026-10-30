/**
 * From the harness's committed view to the browser's contract — the only translation layer. Everything
 * the browser draws comes through here, and every value is narrowed rather than trusted: a document is
 * JSON that a much older version of this file may have written.
 */

import type { EntryRecord } from "@earendil-works/pi-durable";

import type {
    ClientAnswerStats,
    ClientAttachment,
    ClientAuthor,
    ClientBlock,
    ClientEntry,
    ClientImage,
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

/** Types a browser may be handed as an image: anything else (SVG, HTML) could run script from this origin. */
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imagePartsOf(content: unknown): { mimeType: string; data: string }[] {
    const images: { mimeType: string; data: string }[] = [];

    if (!Array.isArray(content)) {
        return images;
    }

    for (const raw of content) {
        const part = recordOf(raw);
        const mimeType = stringOf(part, "mimeType");
        const data = stringOf(part, "data");

        if (
            stringOf(part, "type") === "image" &&
            mimeType !== undefined &&
            IMAGE_MIME_TYPES.has(mimeType) &&
            data !== undefined &&
            data !== ""
        ) {
            images.push({ mimeType, data });
        }
    }

    return images;
}

/** The bytes of the `index`th image a tool result holds: what `GET /api/entry-image` serves. */
export function toolImageOf(
    entry: EntryRecord,
    index: number,
): { mimeType: string; bytes: Buffer } | undefined {
    if (entry.kind !== "pi.tool-result") {
        return undefined;
    }

    const message = recordOf(Array.isArray(entry.model) ? entry.model[0] : undefined);
    const image = imagePartsOf(message?.["content"])[index];

    return image === undefined
        ? undefined
        : { mimeType: image.mimeType, bytes: Buffer.from(image.data, "base64") };
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
        cached: numberAt(usage, "cacheRead"),
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

/** Attachment metadata is persisted with the input, including inputs queued while busy. */
function filesOf(value: unknown): ClientAttachment[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((raw) => {
        const file = recordOf(raw);
        const name = stringOf(file, "name");
        const path = stringOf(file, "path");
        const size = optionalNumber(file, "size");

        return name === undefined || path === undefined || size === undefined
            ? []
            : [{ name, path, size, image: file?.["image"] === true }];
    });
}

/**
 * An input placed as an application entry names its writer in `data.author`, and the conversation it came from in
 * `data.session`: that is how a message the person did not type is told apart from theirs.
 */
function authorOf(data: Record<string, unknown> | undefined): ClientAuthor | undefined {
    const name = stringOf(data, "author");
    const session = optionalNumber(data, "session");

    if (name === undefined || name === "") {
        return undefined;
    }

    return session === undefined ? { name } : { name, session };
}

function userOf(
    id: number,
    message: Record<string, unknown> | undefined,
    data: Record<string, unknown> | undefined,
): ClientEntry {
    const at = optionalNumber(message, "timestamp");
    const files = filesOf(data?.["files"]);
    const author = authorOf(data);

    return {
        id,
        kind: "user",
        text: stringOf(data, "text") ?? textOf(message?.["content"]),
        ...(files.length === 0 ? {} : { files }),
        ...(at === undefined ? {} : { at }),
        ...(author === undefined ? {} : { author }),
    };
}

/** The summary a compaction wrote, out of the message that carries it: the sentences around the tags say nothing new. */
function summaryOf(message: Record<string, unknown> | undefined): string | undefined {
    const text = textOf(message?.["content"]);
    const open = text.indexOf("<summary>");
    const close = text.lastIndexOf("</summary>");
    const summary = open < 0 || close <= open ? text : text.slice(open + "<summary>".length, close);
    const kept = summary.trim();

    return kept === "" ? undefined : kept;
}

/** One entry as the browser shows it. */
export function projectEntry(entry: EntryRecord): ClientEntry {
    const id = Number(entry.id);
    const message = recordOf(Array.isArray(entry.model) ? entry.model[0] : undefined);

    switch (entry.kind) {
        case "pi.user":
        case "chat.user":
            return userOf(id, message, recordOf(entry.data));

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
            const images: ClientImage[] = imagePartsOf(message?.["content"]).map(
                ({ mimeType }) => ({ mimeType }),
            );

            return {
                id,
                kind: "toolResult",
                callId: labelOf(message?.["toolCallId"], ""),
                name: labelOf(message?.["toolName"], "?"),
                // Start and end: a command's summary (a test run's counts, an exit code) is in its last lines.
                text: cut
                    ? `${output.slice(0, OUTPUT_LIMIT / 2)}\n…\n${output.slice(-OUTPUT_LIMIT / 2)}`
                    : output,
                isError: message?.["isError"] === true,
                ...(cut ? { truncated: true } : {}),
                ...(images.length === 0 ? {} : { images }),
                ...(at === undefined ? {} : { at }),
                ...(durationMs === undefined ? {} : { durationMs }),
                ...(diff === undefined ? {} : { diff }),
            };
        }

        case "pi.compaction": {
            const summary = summaryOf(message);

            return { id, kind: "compaction", ...(summary === undefined ? {} : { summary }) };
        }

        default: {
            const data = recordOf(entry.data);

            return message?.["role"] === "user" && authorOf(data) !== undefined
                ? userOf(id, message, data)
                : { id, kind: "other", entryKind: entry.kind };
        }
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

/**
 * Messages waiting in `pi.inbox`. Writes are not messages; they never reach the screen. A queued input keeps the
 * entry it will be placed as, so the card shows what was typed and the files it carries, not the expansion.
 */
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
        const data = recordOf(recordOf(item?.["entry"])?.["data"]);
        const files = filesOf(data?.["files"]);
        const author = authorOf(data);

        if (id !== 0 && (mode === "steer" || mode === "followUp")) {
            queued.push({
                id,
                mode,
                text: stringOf(data, "text") ?? textOf(item?.["content"]),
                ...(files.length === 0 ? {} : { files }),
                ...(author === undefined ? {} : { author }),
            });
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

    const compactions = live["compactions"];

    if (Array.isArray(compactions) && compactions.length > 0) {
        out.compacting = true;
        out.compactionRetrying = compactions.some(
            (status) => recordOf(status)?.["retry"] !== undefined,
        );
    }

    const failed = stringOf(recordOf(live["compactionFailure"]), "error");

    if (failed !== undefined && failed !== "") {
        out.compactionFailed = { error: failed };
    }

    return out;
}
