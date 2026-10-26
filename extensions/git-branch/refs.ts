import { actionRef } from "../../shared/extension-api.ts";

export type Settings = { showInStatusBar: boolean };

export const DEFAULT_SETTINGS: Settings = { showInStatusBar: true };

/** Throws unless `value` is `{ showInStatusBar: boolean }`. */
export function parseSettings(value: unknown): Settings {
    const shown: unknown =
        typeof value === "object" && value !== null
            ? Reflect.get(value, "showInStatusBar")
            : undefined;

    if (typeof shown !== "boolean") {
        throw new Error("settings must be an object with a boolean showInStatusBar");
    }

    return { showInStatusBar: shown };
}

/** The branch of the session's folder, or null when it is not a git checkout. */
export const branch = actionRef<undefined, string | null>("git-branch", "branch", (value) => {
    if (typeof value === "string" || value === null) {
        return value;
    }

    throw new Error("the branch must be a string or null");
});

export const settings = actionRef<undefined, Settings>("git-branch", "settings", parseSettings);

export const setSettings = actionRef<Settings, Settings>(
    "git-branch",
    "setSettings",
    parseSettings,
);
