/**
 * Tags: names the owner gives sessions, kept in `tags.json` in the data folder so every device reads
 * the same ones. The settings screen makes and drops them; a session's own menu puts them on and off.
 * A dropped tag leaves every session it was on, which is the only way an id stops existing.
 */
import { defineExtension } from "@earendil-works/pi-durable";

import { type Action, type ActionCall, ActionError, type Host } from "../../server/sdk.ts";
import type { TagsState } from "./refs.ts";
import { addTag, readTags, removeTag, serialize, toggleTag, writeTags } from "./store.ts";

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

export default function tags(host: Host) {
    return defineExtension({ name: host.name });
}

/** The actions with their names typed, so a test calls one without asking whether it is there. */
export const tagActions = (host: Host) => ({
    state: async (): Promise<TagsState> => await readTags(host.dataDir),
    create: async ({ args }: ActionCall): Promise<TagsState> => {
        const name = fieldOf(args, "name");

        return await serialize(host.dataDir, async () => {
            const state = addTag(await readTags(host.dataDir), name);
            await writeTags(host.dataDir, state);

            return state;
        });
    },
    remove: async ({ args }: ActionCall): Promise<TagsState> => {
        const id = fieldOf(args, "id");

        return await serialize(host.dataDir, async () => {
            const state = removeTag(await readTags(host.dataDir), id);
            await writeTags(host.dataDir, state);

            return state;
        });
    },
    toggle: async ({ args, session }: ActionCall): Promise<TagsState> => {
        if (session === null) {
            throw new ActionError("a session is needed");
        }

        const tag = fieldOf(args, "tag");

        return await serialize(host.dataDir, async () => {
            const state = toggleTag(await readTags(host.dataDir), session.id, tag);
            await writeTags(host.dataDir, state);

            return state;
        });
    },
});

export const actions = (host: Host): Record<string, Action> => tagActions(host);
