/** What the ponytail chip shows and what the switch writes. Browser-safe: `actionRef` only. */
import { actionRef } from "../../shared/extension-api.ts";

export type Mode = { on: boolean };

function parseMode(value: unknown): Mode {
    const on = typeof value === "object" && value !== null ? Reflect.get(value, "on") : undefined;

    if (typeof on !== "boolean") {
        throw new Error("Invalid ponytail state");
    }

    return { on };
}

/** No arguments: whether ponytail mode is on. */
export const state = actionRef<undefined, Mode>("ponytail", "state", parseMode);
/** User-only `{ on }`: turn ponytail mode on or off. Returns the state. */
export const set = actionRef<{ on: boolean }, Mode>("ponytail", "set", parseMode);
