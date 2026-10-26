import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".woff2": "font/woff2",
};

// Only `/assets/` has content hashes in its names. Everything else keeps its name between
// builds, and the worker and the HTML must never be served stale.
const HASHED = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

/**
 * Serves a file of the built web shell. Always writes the response.
 * No fallback to `index.html`: the app routes by query string, so a missing file is a real 404.
 */
export async function serveStatic(
    root: string,
    request: IncomingMessage,
    response: ServerResponse,
): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" }).end();

        return;
    }

    let pathname: string;

    try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
        response.writeHead(400).end();

        return;
    }

    if (pathname.includes("\0")) {
        response.writeHead(400).end();

        return;
    }

    const base = resolve(root);
    const file = resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
    const info = file.startsWith(base + sep) ? await stat(file).catch(() => null) : null;

    if (info === null || !info.isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");

        return;
    }

    response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": pathname.startsWith("/assets/") ? HASHED : REVALIDATE,
        "x-content-type-options": "nosniff",
    });

    if (request.method === "HEAD") {
        response.end();
    } else {
        await pipeline(createReadStream(file), response);
    }
}
