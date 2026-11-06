/** Uploads, the folder browser of the session picker, and its favourite folders. */

import { randomInt } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

import { Hono } from "hono";

import { recordOf } from "../../shared/guards.ts";
import { writeJsonFile } from "../atomic-write.ts";
import { type ApiEnv, readBytes, readJson, RESPONSE_ALREADY_SENT, sessionIdOf } from "../http.ts";
import { readJsonFile } from "../json-file.ts";

export const IMAGE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
};

export function fileRoutes({ dataDir }: { dataDir: string }) {
    const uploadDir = join(dataDir, "uploads");
    const favouritesFile = join(dataDir, "favourites.json");

    async function readFavourites(): Promise<string[]> {
        const parsed = await readJsonFile(favouritesFile);

        return Array.isArray(parsed)
            ? parsed.filter((entry): entry is string => typeof entry === "string")
            : [];
    }

    return new Hono<ApiEnv>()
        .get("/api/favourites", async (c) => {
            return c.json({ folders: await readFavourites() });
        })
        .put("/api/favourites", async (c) => {
            const payload = recordOf(await readJson(c.env.incoming));

            c.set("changedSession", sessionIdOf(payload?.["session"]));

            const raw = payload?.["folders"];
            const folders = Array.isArray(raw)
                ? raw.filter((entry): entry is string => typeof entry === "string")
                : [];

            await writeJsonFile(favouritesFile, folders);

            return c.json({ folders }, 200);
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
        .get("/api/fs", async (c) => {
            const wanted = c.req.query("path") ?? homedir();
            const path = resolve(
                wanted.startsWith("~") ? join(homedir(), wanted.slice(1)) : wanted,
            );
            const hidden = c.req.query("hidden") === "1";

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
        .get("/api/uploads", async (c) => {
            const wanted = resolve(c.req.query("path") ?? "");

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
