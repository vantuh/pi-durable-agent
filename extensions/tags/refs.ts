/** What the tag server half and browser half agree on. Browser-safe: no imports, no Node. */
import { actionRef } from "../../shared/extension-api.ts";

/** Short enough to sit in a row, long enough to name a kind of work. */
export const MAX_NAME = 24;

/** A name the owner gives sessions; the id outlives a rename. */
export type Tag = { readonly id: string; readonly name: string };

/** Every tag, and the tags each session carries, keyed by session id as a string. */
export type TagsState = {
    readonly tags: readonly Tag[];
    readonly sessions: Readonly<Record<string, readonly string[]>>;
};

/** A tag is the same tag whatever sessions it is on, so a chip and a menu row can name it. */
export function tagsOf(state: TagsState | undefined, session: number): readonly Tag[] {
    const held = new Set(state?.sessions[String(session)] ?? []);

    return (state?.tags ?? []).filter((tag) => held.has(tag.id));
}

function tagFrom(value: unknown): Tag {
    const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
    const name =
        typeof value === "object" && value !== null ? Reflect.get(value, "name") : undefined;

    if (typeof id !== "string" || typeof name !== "string") {
        throw new Error("a tag must be { id: string, name: string }");
    }

    return { id, name };
}

function stateFrom(value: unknown): TagsState {
    const tags =
        typeof value === "object" && value !== null ? Reflect.get(value, "tags") : undefined;
    const sessions =
        typeof value === "object" && value !== null ? Reflect.get(value, "sessions") : undefined;

    if (!Array.isArray(tags) || typeof sessions !== "object" || sessions === null) {
        throw new Error("the state must be { tags, sessions }");
    }

    const byId: Record<string, readonly string[]> = {};

    for (const session of Object.keys(sessions)) {
        const held: unknown = Reflect.get(sessions, session);

        if (!Array.isArray(held) || !held.every((id: unknown) => typeof id === "string")) {
            throw new Error("a session's tags must be a list of ids");
        }

        byId[session] = held;
    }

    return { tags: tags.map((tag: unknown) => tagFrom(tag)), sessions: byId };
}

/** Every tag and where it is. */
export const state = actionRef<undefined, TagsState>("tags", "state", stateFrom);

/** Makes a tag; a name already taken is refused. */
export const create = actionRef<{ name: string }, TagsState>("tags", "create", stateFrom);

/** Drops a tag and takes it off every session that had it. */
export const remove = actionRef<{ id: string }, TagsState>("tags", "remove", stateFrom);

/** Puts a tag on the session the call came from, or takes it off. */
export const toggle = actionRef<{ tag: string }, TagsState>("tags", "toggle", stateFrom);
