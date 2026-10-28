import { actionRef } from "../../shared/extension-api.ts";

/** What a held session's row says, and what its menu item reads to offer the way out. */
export const MARK = "Paused";

export type PauseState = { readonly paused: boolean };

function stateOf(value: unknown): PauseState {
    const paused =
        typeof value === "object" && value !== null ? Reflect.get(value, "paused") : undefined;

    if (typeof paused === "boolean") {
        return { paused };
    }

    throw new Error("the state must be { paused: boolean }");
}

/** Holds the session at its next step. */
export const pause = actionRef<undefined, PauseState>("pause", "pause", stateOf);

/** Lets a held session go on. */
export const resume = actionRef<undefined, PauseState>("pause", "resume", stateOf);

/** Holds a running session, or lets a held one go: what a menu needs, one way to say both. */
export const toggle = actionRef<undefined, PauseState>("pause", "toggle", stateOf);

/** Whether the session is held now. */
export const state = actionRef<undefined, PauseState>("pause", "state", stateOf);
