/**
 * Tags: names the owner gives sessions, kept in `tags.json` in the data folder so every device reads
 * the same ones. The settings screen makes and drops them; a session's own menu puts them on and off.
 * A dropped tag leaves every session it was on, which is the only way an id stops existing.
 */
import { defineExtension } from "@earendil-works/pi-durable";

import {
    type Action,
    type ActionCall,
    ActionError,
    type Host,
    serialize,
} from "../../server/sdk.ts";
import { type TagsState, isTagColor, TAG_COLORS } from "./refs.ts";
import {
    addTag,
    readTags,
    recolorTag,
    renameTag,
    removeTag,
    tagsFile,
    toggleTag,
    writeTags,
} from "./server/store.ts";

export const meta = {
    title: "Tags",
    description: "Names sessions with tags you make yourself, and shows them in the session list.",
};

function fieldOf(args: unknown, key: string): string {
    const value = typeof args === "object" && args !== null ? Reflect.get(args, key) : undefined;

    if (typeof value !== "string") {
        throw new ActionError(`args must be { ${key}: string }`);
    }

    return value;
}

function colorOf(args: unknown): string {
    const color =
        typeof args === "object" && args !== null ? Reflect.get(args, "color") : undefined;

    if (!isTagColor(color)) {
        throw new ActionError(`args must be { color: one of ${TAG_COLORS.join(", ")} }`);
    }

    return color;
}

export default function tags(host: Host) {
    return defineExtension({ name: host.name });
}

/** The actions with their names typed, so a test calls one without asking whether it is there. */
export const tagActions = (host: Host) => {
    /** One change to the file: read, edit, write, in the file's queue; the new state is the answer. */
    const change = (edit: (state: TagsState) => TagsState): Promise<TagsState> =>
        serialize(tagsFile(host.dataDir), async () => {
            const state = edit(await readTags(host.dataDir));
            await writeTags(host.dataDir, state);

            return state;
        });

    return {
        state: async (): Promise<TagsState> => await readTags(host.dataDir),
        create: async ({ args }: ActionCall): Promise<TagsState> => {
            const name = fieldOf(args, "name");
            const color = colorOf(args);

            return await change((state) => addTag(state, name, color));
        },
        rename: async ({ args }: ActionCall): Promise<TagsState> => {
            const id = fieldOf(args, "id");
            const name = fieldOf(args, "name");

            return await change((state) => renameTag(state, id, name));
        },
        recolor: async ({ args }: ActionCall): Promise<TagsState> => {
            const id = fieldOf(args, "id");
            const color = colorOf(args);

            return await change((state) => recolorTag(state, id, color));
        },
        remove: async ({ args }: ActionCall): Promise<TagsState> => {
            const id = fieldOf(args, "id");

            return await change((state) => removeTag(state, id));
        },
        toggle: async ({ args, session }: ActionCall): Promise<TagsState> => {
            if (session === null) {
                throw new ActionError("a session is needed");
            }

            const tag = fieldOf(args, "tag");

            return await change((state) => toggleTag(state, session.id, tag));
        },
    };
};

export const actions = (host: Host): Record<string, Action> => tagActions(host);
