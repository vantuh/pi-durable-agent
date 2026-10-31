/** Reading requests and writing JSON answers: what every route of the server does the same way. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constants, createGzip, gzipSync, type Gzip } from "node:zlib";

import { ActionError, ActionNotFound } from "./extensions.ts";

const MAX_BODY = 100_000_000;
/** Unsent bytes past which a stream's reader is gone, as a phone asleep on a dead tunnel is. */
const STALLED_BYTES = 1_000_000;
/** A body smaller than this gains nothing from a gzip header and a compressor: a 400 stays plain. */
const ZIP_MIN_BYTES = 1024;

/** One API route: `path` must match the whole pathname; `method` "*" takes every method. */
export type Route = {
    method: string;
    path: RegExp;
    handle: (
        request: IncomingMessage,
        response: ServerResponse,
        url: URL,
        match: RegExpExecArray,
    ) => Promise<void> | void;
};

export function readBytes(request: IncomingMessage): Promise<Buffer> {
    return new Promise((done, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > MAX_BODY) {
                request.destroy();
                reject(new Error("body is too large"));

                return;
            }

            chunks.push(chunk);
        });
        request.on("end", () => {
            done(Buffer.concat(chunks));
        });
        request.on("error", reject);
    });
}

/** A body is read once per request: a route parses its own, and the caller after the route asks again. */
const bodies = new WeakMap<IncomingMessage, Promise<unknown>>();

/** The parsed body, or `undefined` for an empty one. */
export function readJson(request: IncomingMessage): Promise<unknown> {
    const known = bodies.get(request);

    if (known !== undefined) {
        return known;
    }

    const body = parseJson(request);

    bodies.set(request, body);

    return body;
}

/** The body a route already read, or `undefined` while nothing has: this never waits on a body nobody consumed. */
export function readBody(request: IncomingMessage): Promise<unknown> | undefined {
    return bodies.get(request);
}

async function parseJson(request: IncomingMessage): Promise<unknown> {
    const text = (await readBytes(request)).toString("utf8");

    if (text === "") {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error("body is not JSON");
    }
}

export function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

export function string(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** A session id is a positive integer; anything else is `undefined`. */
export function sessionIdOf(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

/** Whether a client's `accept-encoding` takes gzip: named as `gzip` or through `*`, unless refused with `q=0`. */
function acceptsGzip(request: IncomingMessage): boolean {
    const codings = (request.headers["accept-encoding"] ?? "").split(",").map((entry) => {
        const [coding = "", ...params] = entry.split(";");

        return {
            name: coding.trim().toLowerCase(),
            refused: params.some((param) => /^q=0(?:\.0*)?$/i.test(param.trim())),
        };
    });
    const takes = (name: string): boolean | undefined => {
        const coding = codings.find((entry) => entry.name === name);

        return coding === undefined ? undefined : !coding.refused;
    };

    return takes("gzip") ?? takes("*") ?? false;
}

/** The body gzipped for a client that takes it when the body is big enough to gain; `undefined` to send it plain. */
function gzipBody(request: IncomingMessage, body: string): Buffer | undefined {
    return acceptsGzip(request) && Buffer.byteLength(body) >= ZIP_MIN_BYTES
        ? gzipSync(body)
        : undefined;
}

/**
 * Writes to an event stream, or closes it when its reader stopped reading; the EventSource reconnects
 * and starts from a fresh `hello`, instead of the server buffering every event for it. Bytes the gzip
 * stream still holds have not reached the response, so they count as a backlog too.
 */
export function writeEvent(response: ServerResponse, text: string, gzip?: Gzip): void {
    if (response.writableLength + (gzip?.writableLength ?? 0) > STALLED_BYTES) {
        gzip?.destroy();
        response.destroy();

        return;
    }

    if (gzip === undefined) {
        response.write(text);
    } else {
        gzip.write(text);
    }
}

/**
 * Opens an event stream: its headers, and the gzip stream its frames go through for a client that takes
 * one. Every frame is flushed as it is written, so compression adds nothing to the first paint.
 */
export function openEventStream(
    request: IncomingMessage,
    response: ServerResponse,
): Gzip | undefined {
    const gzip = acceptsGzip(request) ? createGzip({ flush: constants.Z_SYNC_FLUSH }) : undefined;

    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        ...(gzip === undefined ? {} : { "content-encoding": "gzip", vary: "accept-encoding" }),
    });

    if (gzip !== undefined) {
        gzip.pipe(response);
        // The compressor is done when the response is, whichever side closed it.
        response.on("close", () => {
            gzip.destroy();
        });
    }

    return gzip;
}

/**
 * The JSON answer, gzipped for a client that takes it and a body worth it. Only a route whose answer can
 * be big passes `request`; the others keep their answer exactly as it was.
 */
export function answer(
    response: ServerResponse,
    status: number,
    payload: unknown,
    request?: IncomingMessage,
): void {
    let text: string;
    let code = status;

    try {
        text = JSON.stringify(payload);
    } catch (error) {
        code = 500;
        text = JSON.stringify({
            error: error instanceof Error ? error.message : "the result is not JSON",
        });
    }

    const gzipped = request === undefined ? undefined : gzipBody(request, text);

    response.writeHead(code, {
        "content-type": "application/json",
        ...(request === undefined ? {} : { vary: "accept-encoding" }),
        ...(gzipped === undefined ? {} : { "content-encoding": "gzip" }),
    });
    response.end(gzipped ?? text);
}

/** 404 for something unknown, 400 for bad input, 500 for any other failure. */
export function answerError(response: ServerResponse, error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;

    if (error instanceof ActionNotFound) {
        answer(response, 404, { error: message });
    } else if (error instanceof ActionError || error instanceof URIError) {
        answer(response, 400, { error: message });
    } else {
        answer(response, 500, { error: message });
    }
}
