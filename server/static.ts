import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

import { encodingWeights } from "./http.ts";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

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

// PNG and woff2 are compressed already.
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".webmanifest"]);

type Encoding = "br" | "gzip";

// Quality 9 rather than 11: 194 KB against 180 KB for the entry chunk, but 19 ms instead of 760 ms, and the first
// request for a fresh build is the one the phone waits on.
const ENCODERS: Record<Encoding, (data: Buffer) => Promise<Buffer>> = {
    br: (data) =>
        compressBrotli(data, {
            params: {
                [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                [constants.BROTLI_PARAM_QUALITY]: 9,
                [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
            },
        }),
    gzip: (data) => compressGzip(data, { level: 9 }),
};

interface Compressed {
    size: number;
    mtimeMs: number;
    bytes: Promise<Buffer>;
}

// One entry per file and encoding, replaced when the file changes, so a rebuild cannot grow it.
const compressed = new Map<string, Compressed>();

function accepted(header: string | undefined): Encoding | null {
    const weight = encodingWeights(header);

    if (weight("br") > 0) {
        return "br";
    }

    return weight("gzip") > 0 ? "gzip" : null;
}

function compressedBytes(
    file: string,
    encoding: Encoding,
    info: { size: number; mtimeMs: number },
): Promise<Buffer> {
    const key = `${encoding}:${file}`;
    const hit = compressed.get(key);

    if (hit?.size === info.size && hit.mtimeMs === info.mtimeMs) {
        return hit.bytes;
    }

    const bytes = readFile(file).then(ENCODERS[encoding]);

    compressed.set(key, { size: info.size, mtimeMs: info.mtimeMs, bytes });
    // A failed read must not be remembered.
    bytes.catch(() => compressed.delete(key));

    return bytes;
}

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

    const extension = extname(file);
    const headers: Record<string, string> = {
        "content-type": TYPES[extension] ?? "application/octet-stream",
        "cache-control": pathname.startsWith("/assets/") ? HASHED : REVALIDATE,
        "x-content-type-options": "nosniff",
    };

    if (COMPRESSIBLE.has(extension)) {
        headers["vary"] = "accept-encoding";

        const encoding = accepted(request.headers["accept-encoding"]);
        const bytes =
            encoding === null
                ? null
                : await compressedBytes(file, encoding, info).catch(() => null);

        // A tiny file can come out larger; then the identity answer is the better one.
        if (encoding !== null && bytes !== null && bytes.length < info.size) {
            response.writeHead(200, {
                ...headers,
                "content-encoding": encoding,
                "content-length": bytes.length,
            });
            response.end(request.method === "HEAD" ? undefined : bytes);

            return;
        }
    }

    response.writeHead(200, { ...headers, "content-length": info.size });

    if (request.method === "HEAD") {
        response.end();
    } else {
        await pipeline(createReadStream(file), response);
    }
}
