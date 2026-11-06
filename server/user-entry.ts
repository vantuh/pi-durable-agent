/**
 * Which entries are something a person (or an author) said, and what the words are. `projection.ts` draws
 * them for the browser; `sessions.ts` names a session after the first one. One rule for both, so a session is
 * never named after a line the transcript does not show.
 */

import type { EntryRecord } from "@earendil-works/pi-durable";

import { recordOf } from "../shared/guards.ts";

export function stringOf(
    record: Record<string, unknown> | undefined,
    key: string,
): string | undefined {
    const value = record?.[key];

    return typeof value === "string" ? value : undefined;
}

export function textOf(content: unknown): string {
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

/** The first model message of an entry, and its application data. */
export type UserInput = {
    message: Record<string, unknown> | undefined;
    data: Record<string, unknown> | undefined;
};

/**
 * The input of an entry that is a person's message: `pi.user` and `chat.user`, or an application entry whose
 * first model message is a user's and whose `data.author` names a non-empty writer. Undefined for every other entry.
 */
export function userInputOf(entry: EntryRecord): UserInput | undefined {
    const message = recordOf(Array.isArray(entry.model) ? entry.model[0] : undefined);
    const data = recordOf(entry.data);

    switch (entry.kind) {
        case "pi.user":
        case "chat.user":
            return { message, data };

        case "pi.assistant":
        case "pi.tool-result":
        case "pi.compaction":
            return undefined;

        default: {
            const author = stringOf(data, "author");

            return message?.["role"] === "user" && author !== undefined && author !== ""
                ? { message, data }
                : undefined;
        }
    }
}

/** What the entry says, or undefined when it is not a user's input: `data.text` if there is one, else the message. */
export function userTextOf(entry: EntryRecord): string | undefined {
    const input = userInputOf(entry);

    return input === undefined
        ? undefined
        : (stringOf(input.data, "text") ?? textOf(input.message?.["content"]));
}
