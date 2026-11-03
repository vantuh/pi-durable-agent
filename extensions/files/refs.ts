import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

export type Entry = { name: string; dir: boolean };

/** A folder's entries, folders first; `truncated` when the folder had more than the list holds. */
export type Folder = { entries: Entry[]; truncated: boolean };

/** A file as the viewer shows it. Images and binary files are named, not shown. */
export type File =
    | { kind: "text"; size: number; text: string; truncated: boolean }
    | { kind: "image" | "binary" | "other"; size: number };

/** The entries of a folder, `path` relative to the session's folder ("" is the folder itself). */
export const list = actionRef<{ path: string }, Folder>("files", "list", (value) => {
    if (isRecord(value) && Array.isArray(Reflect.get(value, "entries"))) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as Folder;
    }

    throw new Error("not a folder");
});

/** The contents of a file, `path` relative to the session's folder. */
export const read = actionRef<{ path: string }, File>("files", "read", (value) => {
    if (isRecord(value) && typeof Reflect.get(value, "kind") === "string") {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same-repo wire type
        return value as File;
    }

    throw new Error("not a file");
});
