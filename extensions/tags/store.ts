/**
 * The tag file: `{"tags":[{"id","name"}],"sessions":{"12":["id"]}}`. A missing or broken file means
 * no tags; an entry that points at a tag that is not there is dropped with it, so a hand-edited file
 * cannot put a name on a session that no longer exists.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ActionError, writeJsonFile } from "../../server/sdk.ts";
import {
    FALLBACK_COLOR,
    isTagColor,
    MAX_NAME,
    TAG_COLORS,
    type Tag,
    type TagsState,
} from "./refs.ts";

const FILE = "tags.json";

/**
 * Changes to one file run one after another across every instance in the process: a reload makes a
 * new module while the old one may still be writing, and the two would read the same file, so the
 * later write would drop the earlier one's change. An entry lives only while a change is in flight.
 */
const QUEUES = Symbol.for("pi-durable-agent.tags.queues");

type Queues = Map<string, Promise<unknown>>;

function isQueues(value: unknown): value is Queues {
    return value instanceof Map;
}

function queues(): Queues {
    const found: unknown = Reflect.get(globalThis, QUEUES);

    if (isQueues(found)) {
        return found;
    }

    const made: Queues = new Map();

    Reflect.set(globalThis, QUEUES, made);

    return made;
}

/** Runs `work` once the previous change to this folder's tag file has finished. */
export function serialize<T>(dir: string, work: () => Promise<T>): Promise<T> {
    const key = join(dir, FILE);
    const held = queues();
    const next = (held.get(key) ?? Promise.resolve()).then(work, work);

    held.set(
        key,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );

    return next;
}

function tagFrom(value: unknown): Tag | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const id: unknown = Reflect.get(value, "id");
    const name: unknown = Reflect.get(value, "name");
    const color: unknown = Reflect.get(value, "color");

    if (typeof id !== "string" || id === "" || typeof name !== "string" || name.trim() === "") {
        // A nameless tag would draw an empty chip; its assignments go with it, through `known` below.
        return undefined;
    }

    return { id, name, color: isTagColor(color) ? color : FALLBACK_COLOR };
}

export async function readTags(dir: string): Promise<TagsState> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(await readFile(join(dir, FILE), "utf8"));
    } catch {
        return { tags: [], sessions: {} };
    }

    if (typeof parsed !== "object" || parsed === null) {
        return { tags: [], sessions: {} };
    }

    const raw: unknown = Reflect.get(parsed, "tags");
    const tags: Tag[] = [];

    if (Array.isArray(raw)) {
        for (const value of raw) {
            const tag = tagFrom(value);

            if (tag !== undefined) {
                tags.push(tag);
            }
        }
    }

    const known = new Set(tags.map((tag) => tag.id));
    const held: unknown = Reflect.get(parsed, "sessions");
    const sessions: Record<string, string[]> = {};

    if (typeof held === "object" && held !== null) {
        for (const session of Object.keys(held)) {
            const ids: unknown = Reflect.get(held, session);

            if (
                !Array.isArray(ids) ||
                !(Number.isSafeInteger(Number(session)) && Number(session) > 0)
            ) {
                continue;
            }

            const kept = [
                ...new Set(
                    ids.filter((id): id is string => typeof id === "string" && known.has(id)),
                ),
            ];

            if (kept.length > 0) {
                sessions[session] = kept;
            }
        }
    }

    return { tags, sessions };
}

export async function writeTags(dir: string, state: TagsState): Promise<void> {
    await writeJsonFile(join(dir, FILE), state);
}

/** One line, short, and not the name of another tag: `except` is the tag being renamed. */
function tidyName(state: TagsState, raw: string, except?: string): string {
    const name = raw.trim().replace(/\s+/gu, " ");

    if (name === "") {
        throw new ActionError("a tag needs a name");
    }

    if (Array.from(name).length > MAX_NAME) {
        throw new ActionError(`a tag name is at most ${String(MAX_NAME)} characters`);
    }

    const taken = state.tags.some(
        (tag) => tag.id !== except && tag.name.toLowerCase() === name.toLowerCase(),
    );

    if (taken) {
        throw new ActionError(`there is already a tag called ${name}`);
    }

    return name;
}

export function addTag(state: TagsState, raw: string, color: string): TagsState {
    const name = tidyName(state, raw);

    if (!isTagColor(color)) {
        throw new ActionError(`a tag colour is one of ${TAG_COLORS.join(", ")}`);
    }

    return { ...state, tags: [...state.tags, { id: randomUUID(), name, color }] };
}

/** Another name for a tag. The id stays, so every session that carries it still does. */
export function renameTag(state: TagsState, id: string, raw: string): TagsState {
    if (!state.tags.some((tag) => tag.id === id)) {
        throw new ActionError("no such tag");
    }

    const name = tidyName(state, raw, id);

    return { ...state, tags: state.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag)) };
}

/** Another colour for a tag; the sessions it is on keep it, so this is not a remove and an add. */
export function recolorTag(state: TagsState, id: string, color: string): TagsState {
    if (!state.tags.some((tag) => tag.id === id)) {
        throw new ActionError("no such tag");
    }

    if (!isTagColor(color)) {
        throw new ActionError(`a tag colour is one of ${TAG_COLORS.join(", ")}`);
    }

    return {
        ...state,
        tags: state.tags.map((tag) => (tag.id === id ? { ...tag, color } : tag)),
    };
}

/** A removed tag leaves every session it was on: an id with no name would draw an empty chip. */
export function removeTag(state: TagsState, id: string): TagsState {
    if (!state.tags.some((tag) => tag.id === id)) {
        throw new ActionError("no such tag");
    }

    const sessions: Record<string, string[]> = {};

    for (const [session, ids] of Object.entries(state.sessions)) {
        const kept = ids.filter((each) => each !== id);

        if (kept.length > 0) {
            sessions[session] = kept;
        }
    }

    return { tags: state.tags.filter((tag) => tag.id !== id), sessions };
}

export function toggleTag(state: TagsState, session: number, tag: string): TagsState {
    if (!state.tags.some((each) => each.id === tag)) {
        throw new ActionError("no such tag");
    }

    const key = String(session);
    const held = state.sessions[key] ?? [];
    const next = held.includes(tag) ? held.filter((each) => each !== tag) : [...held, tag];
    const sessions: Record<string, readonly string[]> = { ...state.sessions };

    if (next.length === 0) {
        delete sessions[key];
    } else {
        sessions[key] = next;
    }

    return { ...state, sessions };
}
