/**
 * A read-only file viewer for the session's folder. There is no write action here, on purpose; the
 * ideas (limits, binary sniffing, folders first) come from Pi Pocket's `src/server/files.ts` (MIT).
 */

import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host } from "../../server/sdk.ts";
import type { File, Folder } from "./refs.ts";

export const meta = {
    title: "Files",
    description:
        "Browse and read the files of the session's folder. View only; nothing is written.",
};

const VIEW_BYTES = 512 * 1024;
const VIEW_ENTRIES = 1000;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

export default function files(host: Host) {
    return defineExtension({ name: host.name });
}

function pathOf(args: unknown): string {
    const path = typeof args === "object" && args !== null ? Reflect.get(args, "path") : undefined;

    if (typeof path !== "string" || path.includes("\0")) {
        throw new ActionError("A path must be a string.");
    }

    return path;
}

/** The real path of `path` under `cwd`; throws when it leaves the folder, also through a symlink. */
export async function inside(cwd: string, path: string): Promise<string> {
    const root = await realpath(cwd);

    if (isAbsolute(path)) {
        throw new ActionError("Use a path relative to the session's folder.");
    }

    let target: string;

    try {
        target = await realpath(resolve(root, path));
    } catch {
        throw new ActionError("No such file or folder.");
    }

    const from = relative(root, target);

    if (from === ".." || from.startsWith(`..${sep}`) || isAbsolute(from)) {
        throw new ActionError("That path is outside the session's folder.");
    }

    return target;
}

export async function listFolder(dir: string): Promise<Folder> {
    const found = await readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
        found.map(async (entry) => ({
            name: entry.name,
            // A link shows as what it points to; one that points nowhere is a file.
            dir: entry.isSymbolicLink()
                ? await stat(join(dir, entry.name)).then(
                      (target) => target.isDirectory(),
                      () => false,
                  )
                : entry.isDirectory(),
        })),
    );

    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));

    // The cut comes after the sort, so the folders and names that survive it are the ones that sort
    // first, not the ones readdir happened to return first.
    return {
        entries: entries.slice(0, VIEW_ENTRIES),
        truncated: found.length > VIEW_ENTRIES,
    };
}

export async function readFile(file: string): Promise<File> {
    const info = await stat(file);

    // A pipe or a device would never finish reading: only regular files are opened.
    if (!info.isFile()) {
        return { kind: "other", size: info.size };
    }

    if (IMAGE.test(file)) {
        return { kind: "image", size: info.size };
    }

    const handle = await open(file, "r");

    try {
        const buffer = Buffer.alloc(Math.min(info.size, VIEW_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, bytesRead);

        if (bytes.subarray(0, 8000).includes(0)) {
            return { kind: "binary", size: info.size };
        }

        return {
            kind: "text",
            size: info.size,
            text: bytes.toString("utf8"),
            truncated: info.size > bytesRead,
        };
    } finally {
        await handle.close();
    }
}

function cwdOf(session: Parameters<Action>[0]["session"]): string {
    if (session?.cwd === null || session?.cwd === undefined) {
        throw new ActionError("Open a session with a working folder first.");
    }

    return session.cwd;
}

export const actions: Record<string, Action> = {
    async list({ args, session }) {
        return listFolder(await inside(cwdOf(session), pathOf(args)));
    },
    async read({ args, session }) {
        return readFile(await inside(cwdOf(session), pathOf(args)));
    },
};
