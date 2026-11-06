/** Adapted from the Pi extension `auto-session-name` and Pi Web's title policy, using model context. */

import type { Message } from "@earendil-works/pi-ai";

const MAX_TITLE_LENGTH = 80;

// User turns carry the goal; older replies need less detail. Tools add cost without naming the goal.
const USER_CHARS = 800;
const ASSISTANT_CHARS = 300;
const LAST_ASSISTANT_CHARS = 600;
// Keep naming cost bounded regardless of session length.
const TRANSCRIPT_CHARS = 6000;
// Reserve the opening goal so routine follow-ups do not displace it.
const TRANSCRIPT_HEAD_CHARS = Math.round(TRANSCRIPT_CHARS * 0.4);

const ELISION = "[…]";
const IMAGE_PLACEHOLDER = "[image]";

function textOf(content: Message["content"]): string {
    if (typeof content === "string") {
        return content;
    }

    const parts: string[] = [];
    let images = 0;
    for (const block of content) {
        if (block.type === "text") {
            parts.push(block.text);
        } else if (block.type === "image") {
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
        const parsed: unknown = JSON.parse(value);
        const title: unknown =
            typeof parsed === "object" && parsed !== null
                ? Reflect.get(parsed, "title")
                : undefined;
        if (typeof title !== "string") {
            throw new Error("The model did not return a usable session title");
        }
        value = title.trim();
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
