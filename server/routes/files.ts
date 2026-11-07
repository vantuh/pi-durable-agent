/** Uploads, the folder browser of the session picker, its favourite folders, and the sidebar's folder layout. */

import { randomInt } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

import { Hono } from "hono";
import { z } from "zod";

import { FOLDER_COLORS, MAX_FOLDER_NAME } from "../../shared/folders.ts";
import { writeJsonFile } from "../atomic-write.ts";
import { type ApiEnv, readBytes, RESPONSE_ALREADY_SENT } from "../http.ts";
import { IMAGE_TYPES } from "../image-types.ts";
import { readJsonFile } from "../json-file.ts";
import { jsonBody, lenient, queryOf, StringList } from "../validate.ts";

const FavouritesBody = z.object({ folders: StringList });
/** A file or body with a wrong part keeps the right ones: a bad colour is no colour, not a lost layout. */
const FolderLayoutBody = z.object({
    order: StringList,
    collapsed: StringList,
    folders: z
        .record(
            z.string(),
            z.object({
                name: z.string().max(MAX_FOLDER_NAME).optional().catch(undefined),
                color: z.enum(FOLDER_COLORS).optional().catch(undefined),
            }),
        )
        .default({})
        .catch({}),
});
/** `hidden=1` shows the folders that start with a dot. */
const FsQuery = z.object({
    path: lenient(z.string()),
    hidden: lenient(z.string()).transform((value) => value === "1"),
});
const UploadsQuery = z.object({ path: lenient(z.string()) });

export function fileRoutes({ dataDir }: { dataDir: string }) {
    const uploadDir = join(dataDir, "uploads");
    const favouritesFile = join(dataDir, "favourites.json");
    const foldersFile = join(dataDir, "folders.json");

    return new Hono<ApiEnv>()
        .get("/api/favourites", async (c) => {
            return c.json({ folders: StringList.parse(await readJsonFile(favouritesFile)) });
        })
        .put("/api/favourites", jsonBody(FavouritesBody), async (c) => {
            const { folders } = c.req.valid("json");

            await writeJsonFile(favouritesFile, folders);

            return c.json({ folders }, 200);
        })
        .get("/api/folder-layout", async (c) => {
            return c.json(FolderLayoutBody.parse((await readJsonFile(foldersFile)) ?? {}));
        })
        .put("/api/folder-layout", jsonBody(FolderLayoutBody), async (c) => {
            const layout = c.req.valid("json");

            // shortcut: the last write wins between two devices, upgrade if their edits collide.
            await writeJsonFile(foldersFile, layout);

            return c.json(layout, 200);
        })
        .post("/api/files", async (c) => {
            const raw = c.req.header("x-filename");
            const name = basename(decodeURIComponent(raw ?? "file"));
            const saved = join(
                uploadDir,
                `${String(Date.now())}${String(randomInt(1_000_000))}-${name}`,
            );
            const data = await readBytes(c.env.incoming);

            // `wx` makes the rare collision an error the composer shows, never a lost upload.
            await writeFile(saved, data, { flag: "wx" });

            return c.json(
                {
                    path: saved,
                    name,
                    size: data.length,
                    mime: IMAGE_TYPES[extname(name).toLowerCase()] ?? null,
                },
                201,
            );
        })
        .get("/api/fs", queryOf(FsQuery), async (c) => {
            const { hidden, path: wanted = homedir() } = c.req.valid("query");
            const path = resolve(
                wanted.startsWith("~") ? join(homedir(), wanted.slice(1)) : wanted,
            );

            try {
                const entries = await readdir(path, { withFileTypes: true });
                const dirs = entries
                    .filter((entry) => entry.isDirectory())
                    .filter((entry) => hidden || !entry.name.startsWith("."))
                    .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
                    .sort((left, right) => left.name.localeCompare(right.name));

                return c.json({
                    path,
                    parent: path === "/" ? null : resolve(path, ".."),
                    home: homedir(),
                    dirs,
                });
            } catch {
                return c.json({ error: "cannot read that folder" }, 400);
            }
        })
        .get("/api/uploads", queryOf(UploadsQuery), async (c) => {
            const wanted = resolve(c.req.valid("query").path ?? "");

            if (!wanted.startsWith(uploadDir + sep)) {
                return c.json({ error: "not an uploaded file" }, 403);
            }

            try {
                const data = await readFile(wanted);

                c.env.outgoing.writeHead(200, {
                    "content-type":
                        IMAGE_TYPES[extname(wanted).toLowerCase()] ?? "application/octet-stream",
                    "cache-control": "private, max-age=3600",
                });
                c.env.outgoing.end(data);
            } catch {
                return c.json({ error: "no such file" }, 404);
            }

            return RESPONSE_ALREADY_SENT;
        });
}
