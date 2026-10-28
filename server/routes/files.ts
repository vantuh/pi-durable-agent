/** Uploads, the folder browser of the session picker, and its favourite folders. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

import { answer, readBytes, readJson, record, type Route } from "../http.ts";

export const IMAGE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
};

export function fileRoutes({ dataDir }: { dataDir: string }): Route[] {
    const uploadDir = join(dataDir, "uploads");
    const favouritesFile = join(dataDir, "favourites.json");

    async function readFavourites(): Promise<string[]> {
        try {
            const parsed: unknown = JSON.parse(await readFile(favouritesFile, "utf8"));

            return Array.isArray(parsed)
                ? parsed.filter((entry): entry is string => typeof entry === "string")
                : [];
        } catch {
            return [];
        }
    }

    return [
        {
            method: "GET",
            path: /^\/api\/favourites$/,
            handle: async (_request, response) => {
                answer(response, 200, { folders: await readFavourites() });
            },
        },
        {
            method: "PUT",
            path: /^\/api\/favourites$/,
            handle: async (request, response) => {
                const raw = record(await readJson(request))?.["folders"];
                const folders = Array.isArray(raw)
                    ? raw.filter((entry): entry is string => typeof entry === "string")
                    : [];

                await writeFile(favouritesFile, JSON.stringify(folders));
                answer(response, 200, { folders });
            },
        },
        {
            method: "POST",
            path: /^\/api\/files$/,
            handle: async (request, response) => {
                const raw = request.headers["x-filename"];
                const name = basename(decodeURIComponent(typeof raw === "string" ? raw : "file"));
                const saved = join(uploadDir, `${String(Date.now())}-${name}`);
                const data = await readBytes(request);

                await writeFile(saved, data);
                answer(response, 201, {
                    path: saved,
                    name,
                    size: data.length,
                    mime: IMAGE_TYPES[extname(name).toLowerCase()] ?? null,
                });
            },
        },
        {
            method: "GET",
            path: /^\/api\/fs$/,
            handle: async (_request, response, url) => {
                const wanted = url.searchParams.get("path") ?? homedir();
                const path = resolve(
                    wanted.startsWith("~") ? join(homedir(), wanted.slice(1)) : wanted,
                );
                const hidden = url.searchParams.get("hidden") === "1";

                try {
                    const entries = await readdir(path, { withFileTypes: true });
                    const dirs = entries
                        .filter((entry) => entry.isDirectory())
                        .filter((entry) => hidden || !entry.name.startsWith("."))
                        .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
                        .sort((left, right) => left.name.localeCompare(right.name));

                    answer(response, 200, {
                        path,
                        parent: path === "/" ? null : resolve(path, ".."),
                        home: homedir(),
                        dirs,
                    });
                } catch {
                    answer(response, 400, { error: "cannot read that folder" });
                }
            },
        },
        {
            method: "GET",
            path: /^\/api\/uploads$/,
            handle: async (_request, response, url) => {
                const wanted = resolve(url.searchParams.get("path") ?? "");

                if (!wanted.startsWith(uploadDir + sep)) {
                    answer(response, 403, { error: "not an uploaded file" });

                    return;
                }

                try {
                    const data = await readFile(wanted);

                    response.writeHead(200, {
                        "content-type":
                            IMAGE_TYPES[extname(wanted).toLowerCase()] ??
                            "application/octet-stream",
                        "cache-control": "private, max-age=3600",
                    });
                    response.end(data);
                } catch {
                    answer(response, 404, { error: "no such file" });
                }
            },
        },
    ];
}
