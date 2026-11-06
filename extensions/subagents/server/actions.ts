import { type Action, ActionError, type Host } from "../../../server/sdk.ts";
import type { NamedAgent, ProfileRow, Strip } from "../refs.ts";
import { AgentsDoc } from "./docs.ts";
import { writeProfileModel } from "./profile-model.ts";
import { type Profile, readProfiles } from "./profiles.ts";
import { seen, stripAgent } from "./strip.ts";

/** The profiles as the Extensions dialog lists them, by name. */
function profileRows(found: Map<string, Profile>): ProfileRow[] {
    return [...found.values()]
        .map((profile) => ({
            name: profile.name,
            description: profile.description,
            model: profile.model ?? null,
            thinking: typeof profile.thinking === "string" ? profile.thinking : null,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The action's args, checked: the name of a profile this server discovered, and a model or none. */
function setModelArgs(value: unknown): {
    profile: string;
    model: string | null;
    thinking: string | null;
} {
    if (typeof value !== "object" || value === null) {
        throw new ActionError("args must be { profile, model, thinking }");
    }

    const profile: unknown = Reflect.get(value, "profile");
    const model: unknown = Reflect.get(value, "model");
    const thinking: unknown = Reflect.get(value, "thinking");
    const name = typeof profile === "string" ? profile.trim() : "";

    if (name === "") {
        throw new ActionError("profile must be the name of an agent profile");
    }

    if (model !== null && (typeof model !== "string" || !/^\S+\/\S+$/.test(model))) {
        throw new ActionError("model must be provider/modelId, or null to name none");
    }

    if (thinking !== null && (typeof thinking !== "string" || thinking.trim() === "")) {
        throw new ActionError("thinking must be a thinking level, or null to name none");
    }

    return { profile: name, model, thinking };
}

export const actions = (host: Host): Record<string, Action> => ({
    async agents({ session }): Promise<NamedAgent[]> {
        if (session === null) {
            return [];
        }

        const { agents } = await host.readDoc(AgentsDoc, session.id);

        return Object.entries(agents)
            .map(([name, record]) => ({
                session: Number(record.conversationId),
                name,
                profile: record.agent,
            }))
            .toSorted((a, b) => a.session - b.session);
    },
    async profiles({ session }): Promise<ProfileRow[]> {
        return profileRows(await readProfiles(session?.cwd ?? host.cwd));
    },
    async setModel({ args, session }): Promise<ProfileRow[]> {
        const edit = setModelArgs(args);
        const cwd = session?.cwd ?? host.cwd;
        const profile = (await readProfiles(cwd)).get(edit.profile);

        if (profile === undefined) {
            throw new ActionError(`Unknown agent profile: ${edit.profile}`);
        }

        // The client names a profile, never a path: the file is the one discovery found for it.
        await writeProfileModel(profile.filePath, { model: edit.model, thinking: edit.thinking });

        return profileRows(await readProfiles(cwd));
    },
    async strip({ session }): Promise<Strip> {
        if (session === null) {
            return { parent: null, agents: [] };
        }

        if (session.owner !== undefined) {
            const title = await host.sessionTitle(session.owner);

            return { parent: { id: session.owner, title: title ?? "New session" }, agents: [] };
        }

        const working = [...seen]
            .filter(([, child]) => child.owner === session.id)
            .toSorted(([a], [b]) => a - b);

        if (working.length === 0) {
            return { parent: null, agents: [] };
        }

        // The parent's record is the one durable place that says who each child is.
        const { agents } = await host.readDoc(AgentsDoc, session.id);
        const named = new Map(
            Object.entries(agents).map(([name, record]) => [
                Number(record.conversationId),
                { name, profile: record.agent },
            ]),
        );

        return {
            parent: null,
            agents: await Promise.all(
                working.map(([id, child]) =>
                    stripAgent(host, id, child, named.get(id), session.cwd ?? host.cwd),
                ),
            ),
        };
    },
});
