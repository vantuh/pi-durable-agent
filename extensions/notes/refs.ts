import { actionRef } from "../../shared/extension-api.ts";

/** A note as it is on disk; `version` is a hash of `text`, and a missing note is the empty text. */
export type Note = { text: string; version: string };

/** `conflict`: the note changed since `base`; `text` and `version` are what is on disk now. */
export type WriteResult = { conflict: false; version: string } | ({ conflict: true } & Note);

function isNote(value: unknown): value is Note {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof Reflect.get(value, "text") === "string" &&
        typeof Reflect.get(value, "version") === "string"
    );
}

/** The session's repository note; null when the session has no folder. */
export const read = actionRef<undefined, Note | null>("notes", "read", (value) => {
    if (value === null || isNote(value)) {
        return value;
    }

    throw new Error("not a note");
});

/** Writes only if the note on disk still has the version `base`. */
export const write = actionRef<{ text: string; base: string }, WriteResult>(
    "notes",
    "write",
    (value) => {
        if (typeof value === "object" && value !== null) {
            const version: unknown = Reflect.get(value, "version");

            if (Reflect.get(value, "conflict") === false && typeof version === "string") {
                return { conflict: false, version };
            }

            if (Reflect.get(value, "conflict") === true && isNote(value)) {
                return { conflict: true, text: value.text, version: value.version };
            }
        }

        throw new Error("not a write result");
    },
);

/** Open Markdown checkboxes (`- [ ]`, `* [ ]`, any indentation). */
export function openTasks(text: string): number {
    return text.match(/^[ \t]*[-*][ \t]+\[ \](?=[ \t]|$)/gm)?.length ?? 0;
}
