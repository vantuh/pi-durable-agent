/** What the caveman chip shows and what the switch writes. Browser-safe: `actionRef` only. */
import { actionRef } from "../../shared/extension-api.ts";

export type Mode = { on: boolean };

function parseMode(value: unknown): Mode {
    const on = typeof value === "object" && value !== null ? Reflect.get(value, "on") : undefined;

    if (typeof on !== "boolean") {
        throw new Error("Invalid caveman state");
    }

    return { on };
}

/** No arguments: whether the caveman voice is on. */
export const state = actionRef<undefined, Mode>("caveman", "state", parseMode);
/** User-only `{ on }`: turn the caveman voice on or off. Returns the state. */
export const set = actionRef<{ on: boolean }, Mode>("caveman", "set", parseMode);
