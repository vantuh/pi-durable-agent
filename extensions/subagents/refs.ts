import { actionRef } from "../../shared/extension-api.ts";

/** One agent the parent started that is working now. `fill` is 0 to 100; `window` is 0 until it has answered. */
export type StripAgent = {
    name: string;
    profile: string;
    model: string;
    session: number;
    fill: number;
    used: number;
    window: number;
    working: boolean;
};

/** For a session started by a parent: the parent. Otherwise the agents it started that are working. */
export type Strip = {
    parent: { id: number; title: string } | null;
    agents: StripAgent[];
};

function isRecord(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

function isAgent(value: unknown): value is StripAgent {
    return (
        isRecord(value) &&
        typeof Reflect.get(value, "name") === "string" &&
        typeof Reflect.get(value, "profile") === "string" &&
        typeof Reflect.get(value, "model") === "string" &&
        typeof Reflect.get(value, "session") === "number" &&
        typeof Reflect.get(value, "fill") === "number" &&
        typeof Reflect.get(value, "used") === "number" &&
        typeof Reflect.get(value, "window") === "number" &&
        typeof Reflect.get(value, "working") === "boolean"
    );
}

function isParent(value: unknown): value is { id: number; title: string } {
    return (
        isRecord(value) &&
        typeof Reflect.get(value, "id") === "number" &&
        typeof Reflect.get(value, "title") === "string"
    );
}

function isStrip(value: unknown): value is Strip {
    if (!isRecord(value)) {
        return false;
    }

    const parent: unknown = Reflect.get(value, "parent");
    const agents: unknown = Reflect.get(value, "agents");

    return (parent === null || isParent(parent)) && Array.isArray(agents) && agents.every(isAgent);
}

/** The agent strip of a session: its parent when it is an agent's conversation, else the agents working for it. */
export const strip = actionRef<undefined, Strip>("subagents", "strip", (value) => {
    if (isStrip(value)) {
        return value;
    }

    throw new Error("the agent strip is malformed");
});

/**
 * An agent a conversation started: its name and profile from that conversation's record. When its
 * run ended is not here: it is `SessionSummary.endedAt`, from the core.
 */
export type NamedAgent = {
    session: number;
    name: string;
    profile: string;
};

function isNamedAgent(value: unknown): value is NamedAgent {
    return (
        isRecord(value) &&
        typeof Reflect.get(value, "session") === "number" &&
        typeof Reflect.get(value, "name") === "string" &&
        typeof Reflect.get(value, "profile") === "string"
    );
}

/** The name and profile of every agent the session started, finished or not. Empty for any other session. */
export const agents = actionRef<undefined, NamedAgent[]>("subagents", "agents", (value) => {
    if (Array.isArray(value) && value.every(isNamedAgent)) {
        return value;
    }

    throw new Error("the agent names are malformed");
});

/** One agent profile as the Extensions dialog lists it: what its Markdown frontmatter says. */
export type ProfileRow = {
    name: string;
    description: string;
    /** `provider/modelId`, or null while the profile names none. */
    model: string | null;
    /** A thinking level, or null: absent thinking means off. */
    thinking: string | null;
};

function optional(value: unknown): boolean {
    return value === null || typeof value === "string";
}

function isProfileRow(value: unknown): value is ProfileRow {
    return (
        isRecord(value) &&
        typeof Reflect.get(value, "name") === "string" &&
        typeof Reflect.get(value, "description") === "string" &&
        optional(Reflect.get(value, "model")) &&
        optional(Reflect.get(value, "thinking"))
    );
}

function profileRows(value: unknown): ProfileRow[] {
    if (Array.isArray(value) && value.every(isProfileRow)) {
        return value;
    }

    throw new Error("the agent profiles are malformed");
}

/** Every profile a spawn would see now: the user's, with the project's replacing them by name. */
export const profiles = actionRef<undefined, ProfileRow[]>("subagents", "profiles", profileRows);

/** The model a profile runs with; null for both clears the lines, so the profile names neither. */
export type SetModelArgs = { profile: string; model: string | null; thinking: string | null };

/** Writes a profile's model and thinking into its Markdown, and returns the profiles as they are after it. */
export const setModel = actionRef<SetModelArgs, ProfileRow[]>("subagents", "setModel", profileRows);
