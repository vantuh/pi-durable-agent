import { actionRef } from "../../shared/extension-api.ts";

/** Whether a settled session is named from its conversation; off until someone turns it on. */
export type AutoNameSettings = { readonly auto: boolean };

function settingsOf(value: unknown): AutoNameSettings {
    const auto =
        typeof value === "object" && value !== null ? Reflect.get(value, "auto") : undefined;

    if (typeof auto === "boolean") {
        return { auto };
    }

    throw new Error("the settings must be { auto: boolean }");
}

function titleOf(value: unknown): { title: string } {
    const title =
        typeof value === "object" && value !== null ? Reflect.get(value, "title") : undefined;

    if (typeof title === "string") {
        return { title };
    }

    throw new Error("the result must be { title: string }");
}

/** Names the session from its conversation, replacing the name it has. */
export const generate = actionRef<undefined, { title: string }>(
    "auto-session-name",
    "generate",
    titleOf,
);

export const settings = actionRef<undefined, AutoNameSettings>(
    "auto-session-name",
    "settings",
    settingsOf,
);

export const setAuto = actionRef<{ auto: boolean }, AutoNameSettings>(
    "auto-session-name",
    "setAuto",
    settingsOf,
);
