/**
 * The stream, as this version can read it. The server is the only writer and `shared/protocol.ts` is
 * the contract both sides compile against, so a known `type` with a session is all that is checked
 * here: a type this version does not know is dropped instead of breaking the page.
 */

import type { ClientHistory, ServerEvent } from "../../../shared/protocol.ts";

const TYPES: readonly unknown[] = ["hello", "entries", "live", "extension-notice", "error"];

/** A known event type with a session: the rest of the shape is `ServerEvent` by contract. */
function isEvent(value: object): value is ServerEvent {
    const type: unknown = Reflect.get(value, "type");
    const session: unknown = Reflect.get(value, "session");

    return typeof session === "number" && TYPES.includes(type);
}

export function parseEvent(raw: string): ServerEvent | undefined {
    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }

    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    return isEvent(value) ? value : undefined;
}

/** A page of older entries with a flag: the rest of the shape is `ClientHistory` by the same contract. */
function isPage(value: object): value is ClientHistory {
    const entries: unknown = Reflect.get(value, "entries");
    const more: unknown = Reflect.get(value, "more");

    return Array.isArray(entries) && typeof more === "boolean";
}

export function parseHistory(value: unknown): ClientHistory | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    return isPage(value) ? value : undefined;
}
