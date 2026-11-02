/** What the tag server half and browser half agree on. Browser-safe: no imports, no Node. */
import { actionRef } from "../../shared/extension-api.ts";

/** Short enough to sit in a row, long enough to name a kind of work. */
export const MAX_NAME = 24;

/** The hues a tag may be; each has a `tag-*` role in the theme and a class in `tones.ts`. */
export const TAG_COLORS = [
    "red",
    "peach",
    "yellow",
    "green",
    "teal",
    "blue",
    "mauve",
    "pink",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/** What a tag read from a file written before colours takes, and what a row falls back to. */
export const FALLBACK_COLOR: TagColor = "mauve";

export function isTagColor(value: unknown): value is TagColor {
    return TAG_COLORS.some((color) => color === value);
}

/** A name the owner gives sessions, its colour, and an id that outlives a rename. */
export type Tag = { readonly id: string; readonly name: string; readonly color: TagColor };

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
    const color =
        typeof value === "object" && value !== null ? Reflect.get(value, "color") : undefined;

    if (typeof id !== "string" || typeof name !== "string" || !isTagColor(color)) {
        throw new Error("a tag must be { id: string, name: string, color: a tag colour }");
    }

    return { id, name, color };
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

/** Makes a tag; a name already taken is refused, and so is a colour the theme does not have. */
export const create = actionRef<{ name: string; color: TagColor }, TagsState>(
    "tags",
    "create",
    stateFrom,
);

/** Gives a tag another name; the sessions it is on keep it, because its id does not change. */
export const rename = actionRef<{ id: string; name: string }, TagsState>(
    "tags",
    "rename",
    stateFrom,
);

/** Gives a tag another colour; the sessions it is on are untouched. */
export const recolor = actionRef<{ id: string; color: TagColor }, TagsState>(
    "tags",
    "recolor",
    stateFrom,
);

/** Drops a tag and takes it off every session that had it. */
export const remove = actionRef<{ id: string }, TagsState>("tags", "remove", stateFrom);

/** Puts a tag on the session the call came from, or takes it off. */
export const toggle = actionRef<{ tag: string }, TagsState>("tags", "toggle", stateFrom);
