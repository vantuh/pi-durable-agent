/**
 * What the terminal panel and its server half agree on. Browser-safe: no imports beyond the shared ones.
 *
 * `seq` counts every character the shell has sent since it started, so a reader that says where it got
 * to gets the rest — the scrollback on attaching, one chunk per answer afterwards.
 */

import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

export type Size = { cols: number; rows: number };

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

/** Starts a shell in the session's folder, or attaches to the one running: its recent scrollback and `seq`. */
export const open = actionRef<Size, Output>("terminal", "open", parseOutput);

/** Keys, pastes and control characters, exactly as the terminal sends them. */
export const write = actionRef<{ data: string }, true>("terminal", "write", () => true);

/** The shell and the program it runs now: a stop asks first when the two differ. */
export const state = actionRef<undefined, Running>("terminal", "state", (value) => {
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
export const read = actionRef<{ after: number }, Output | null>("terminal", "read", (value) =>
    value === null ? null : parseOutput(value),
);

/** The size the panel fitted: the shell and the programs in it wrap to it. */
export const resize = actionRef<Size, true>("terminal", "resize", () => true);

/** Ends the shell. The next `open` starts a new one. */
export const close = actionRef<undefined, true>("terminal", "close", () => true);
