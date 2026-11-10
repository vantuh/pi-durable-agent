/**
 * What the terminal page and its server half agree on. Browser-safe: no imports beyond the shared ones.
 *
 * `seq` counts every character the shell has sent since it started, so a reader that says where it got
 * to gets the rest — the scrollback on attaching, one chunk per answer afterwards. Every call but `list`
 * and `create` names its `tab`: the shells belong to the session's folder, one per tab.
 */

import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

export const TERMINAL_PAGE = "terminal";

export type Size = { cols: number; rows: number };

type At = { tab: number };

/** One tab of the folder: `title` is what runs in it now, the shell or its foreground program. */
export type Tab = { id: number; title: string; exited: boolean };

export type Output = { seq: number; data: string; exited: boolean };

/** What the shell is running now, both by name: the shell itself, or the program in the foreground. */
export type Running = { shell: string; foreground: string };

function parseOutput(value: unknown): Output {
    if (
        isRecord(value) &&
        typeof Reflect.get(value, "seq") === "number" &&
        typeof Reflect.get(value, "data") === "string" &&
        typeof Reflect.get(value, "exited") === "boolean"
    ) {
        // The server built it from `Shell.output`; the fields are not re-checked one by one.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as Output;
    }

    throw new Error("not terminal output");
}

function isTab(value: unknown): value is Tab {
    return (
        isRecord(value) &&
        typeof Reflect.get(value, "id") === "number" &&
        typeof Reflect.get(value, "title") === "string" &&
        typeof Reflect.get(value, "exited") === "boolean"
    );
}

/** The folder's tabs, oldest first. */
export const list = actionRef<undefined, Tab[]>("terminal", "list", (value) => {
    if (Array.isArray(value) && value.every(isTab)) {
        return value;
    }

    throw new Error("not a list of terminal tabs");
});

/** Starts a shell in a new tab of the session's folder, and answers the tab. */
export const create = actionRef<undefined, number>("terminal", "create", (value) => {
    if (typeof value === "number") {
        return value;
    }

    throw new Error("not a terminal tab");
});

/** Attaches to the tab's shell, or starts a new one there if it ended: its recent scrollback and `seq`. */
export const open = actionRef<At & Size, Output>("terminal", "open", parseOutput);

/** Keys, pastes and control characters, exactly as the terminal sends them. */
export const write = actionRef<At & { data: string }, true>("terminal", "write", () => true);

/** The shell and the program it runs now: a stop asks first when the two differ. */
export const state = actionRef<At, Running>("terminal", "state", (value) => {
    if (
        isRecord(value) &&
        typeof Reflect.get(value, "shell") === "string" &&
        typeof Reflect.get(value, "foreground") === "string"
    ) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as Running;
    }

    throw new Error("not what the shell is running");
});

/** The output after `after`, waiting up to 25 seconds for it. Null: nothing came. */
export const read = actionRef<At & { after: number }, Output | null>("terminal", "read", (value) =>
    value === null ? null : parseOutput(value),
);

/** The size the page fitted: the shell and the programs in it wrap to it. */
export const resize = actionRef<At & Size, true>("terminal", "resize", () => true);

/** Ends the tab's shell and keeps the tab. The next `open` starts a new one there. */
export const close = actionRef<At, true>("terminal", "close", () => true);

/** Ends the tab's shell and closes the tab. */
export const remove = actionRef<At, true>("terminal", "remove", () => true);
