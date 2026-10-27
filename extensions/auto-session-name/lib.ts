/**
 * Pure helpers behind the session namer: the transcript the title model reads and the cleanup applied
 * to its answer. No runtime imports, so tests can exercise them without the Pi runtime.
 *
 * The policy mirrors Pi Web's lib/session-title.ts.
 *
 * Copied from the Pi extension `auto-session-name`, which reads Pi's whole session record. This app
 * reads the model context, so the roles that only a session record has — `bashExecution`,
 * `compactionSummary`, `branchSummary`, `custom` — are dropped along with their branches: here a
 * compaction reaches the model as the user message that carries it, and nothing else exists. The
 * type comes from `@earendil-works/pi-ai`, so a changed message shape breaks this file instead of
 * passing it silently.
 */

import type { Message } from "@earendil-works/pi-ai";

const MAX_TITLE_LENGTH = 80;

// Per-message caps: every user turn carries the goal, only the newest reply
// needs its body, and the replies between them only need their opening line.
// Tool calls and their results are dropped outright, because they dominate the
// token count while saying nothing about what the user wanted.
const USER_CHARS = 800;
const ASSISTANT_CHARS = 300;
const LAST_ASSISTANT_CHARS = 600;
// Total budget across all messages, so a long session does not cost more to
// name than a short one.
const TRANSCRIPT_CHARS = 6000;
// Share reserved for the opening turns: a session states its goal early and
// then drifts into routine follow-ups, and naming it after its last chore is
// worse than naming it after the work it started with.
const TRANSCRIPT_HEAD_CHARS = Math.round(TRANSCRIPT_CHARS * 0.4);

const ELISION = "[…]";
const IMAGE_PLACEHOLDER = "[image]";

function textOf(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }

    const parts: string[] = [];
    let images = 0;
    for (const block of content as readonly unknown[]) {
        if (typeof block !== "object" || block === null) {
            continue;
        }
        const { type } = block as { type?: unknown };
        if (type === "text") {
            const { text } = block as { text?: unknown };
            if (typeof text === "string") {
                parts.push(text);
            }
        } else if (type === "image") {
            images += 1;
        }
    }

    const text = parts.join("\n").trim();
    if (images === 0) {
        return text;
    }
    const marker = images === 1 ? IMAGE_PLACEHOLDER : `${IMAGE_PLACEHOLDER} ×${images}`;
    return text ? `${text}\n${marker}` : marker;
}

/** Truncates by code point so a clip never splits a surrogate pair. */
function clip(text: string, max: number): string {
    const characters = Array.from(text);
    return characters.length <= max ? text : `${characters.slice(0, max).join("")}…`;
}

/**
 * A title needs the goal the session opened with and the outcome it reached.
 * The middle is what makes a long session expensive, so keep both ends and
 * drop it: cost and latency then stop tracking session length.
 */
function boundTranscript(lines: readonly string[]): string {
    const joined = lines.join("\n\n");
    if (joined.length <= TRANSCRIPT_CHARS || lines.length < 2) {
        return joined;
    }

    const head: string[] = [];
    let used = ELISION.length + 4;
    let next = 0;
    // The first line always survives, however long the session is.
    for (; next < lines.length; next += 1) {
        const line = lines[next] ?? "";
        const size = used + line.length + 2;
        if (head.length > 0 && size > TRANSCRIPT_HEAD_CHARS) {
            break;
        }
        head.push(line);
        used = size;
    }

    const tail: string[] = [];
    for (let index = lines.length - 1; index >= next; index -= 1) {
        const line = lines[index] ?? "";
        const size = used + line.length + 2;
        if (size > TRANSCRIPT_CHARS) {
            break;
        }
        tail.unshift(line);
        used = size;
    }

    if (next + tail.length >= lines.length) {
        return joined;
    }
    return [...head, ELISION, ...tail].join("\n\n");
}

function lineForMessage(message: Message, lastAssistant: Message | undefined): string | undefined {
    if (message.role !== "user" && message.role !== "assistant") {
        return undefined;
    }

    const text = textOf(message.content).trim();
    if (!text) {
        return undefined;
    }
    if (message.role === "user") {
        return `User: ${clip(text, USER_CHARS)}`;
    }
    const cap = message === lastAssistant ? LAST_ASSISTANT_CHARS : ASSISTANT_CHARS;
    return `Assistant: ${clip(text, cap)}`;
}

/** Flattens the session into the plain-text transcript the title model reads. */
export function buildTitleTranscript(messages: readonly Message[]): string {
    let lastAssistant: Message | undefined;
    for (const message of messages) {
        if (message.role === "assistant" && textOf(message.content).trim()) {
            lastAssistant = message;
        }
    }

    const lines: string[] = [];
    for (const message of messages) {
        const line = lineForMessage(message, lastAssistant);
        if (line) {
            lines.push(line);
        }
    }
    return boundTranscript(lines);
}

/** Removes the one outer quote pair a chatty model may have wrapped the title in. */
function stripWrappingQuotes(value: string): string {
    const pairs: ReadonlyArray<readonly [string, string]> = [
        ['"', '"'],
        ["'", "'"],
        ["`", "`"],
        ["\u201c", "\u201d"],
        ["\u300c", "\u300d"],
        ["\u300e", "\u300f"],
    ];
    for (const [start, end] of pairs) {
        if (value.startsWith(start) && value.endsWith(end) && value.length > 2) {
            return value.slice(start.length, -end.length).trim();
        }
    }
    return value;
}

/** Converges the model's free text into a single-line session name. */
export function parseGeneratedSessionTitle(raw: string): string {
    let value = raw.trim();
    const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
        value = (fenced[1] ?? "").trim();
    }

    if (value.startsWith("{")) {
        try {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read by key, and `title` is checked before it is used
            const parsed = JSON.parse(value) as { title?: unknown };
            if (typeof parsed.title === "string") {
                value = parsed.title.trim();
            }
        } catch {
            // Not JSON after all; the plain-text cleanup below still applies.
        }
    }

    value = value.split(/\r?\n/, 1)[0] ?? "";
    value = value.replace(/^(?:session\s+title|title|标题|назва|заголовок)\s*[:：-]\s*/i, "");
    value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
    value = value.replace(/[。.!]+$/u, "").trim();

    if (!/[\p{L}\p{N}]/u.test(value)) {
        throw new Error("The model did not return a usable session title");
    }

    const characters = Array.from(value);
    if (characters.length > MAX_TITLE_LENGTH) {
        value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
    }
    return value;
}
