/** Reading requests and writing JSON answers: what every route of the server does the same way. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { constants, createGzip, gzipSync, type Gzip } from "node:zlib";

import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";

import { ActionError, ActionNotFound } from "./extensions.ts";

const MAX_BODY = 100_000_000;
/** Unsent bytes past which a stream's reader is gone, as a phone asleep on a dead tunnel is. */
const STALLED_BYTES = 1_000_000;
/** A body smaller than this gains nothing from a gzip header and a compressor: a 400 stays plain. */
const ZIP_MIN_BYTES = 1024;

/**
 * What a route reads from its context: the Node request and response, for a route that writes by hand, and
 * what the list bookkeeping settles after it.
 */
export type ApiEnv = {
    Bindings: HttpBindings;
    Variables: {
        /** The session a request's body named: the list resends that row instead of every row. */
        changedSession: number | undefined;
        /** Set by the not-found answer: a request no route took changed nothing. */
        unmatched: boolean;
    };
};

/** A route that wrote the response itself returns this, so the adapter leaves the bytes alone. */
export { RESPONSE_ALREADY_SENT };

/** A failure that names the status its answer takes; `answerError` answers with it. */
export class HttpError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** The request's body, refused past `limit` bytes: a route that takes a bigger one names its own limit. */
export function readBytes(request: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
    return new Promise((done, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > limit) {
                request.destroy();
                reject(new HttpError(413, "body is too large"));

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

/** The parsed body, or `undefined` for an empty one; a body past `limit` bytes is refused unread. */
export async function readJson(request: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
    const text = (await readBytes(request, limit)).toString("utf8");

    if (text === "") {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, "body is not JSON");
    }
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

/**
 * The weight an `accept-encoding` header gives a coding: its own `q`, else `*`'s, else 0. A coding the header names
 * outranks `*` even when it is refused, so `gzip;q=0, *` takes no gzip. `q=0` is a refusal.
 */
export function encodingWeights(header: string | undefined): (coding: string) => number {
    const weights = new Map<string, number>();

    for (const part of (header ?? "").split(",")) {
        const [name = "", ...params] = part.trim().toLowerCase().split(";");
        const q = params.map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);

        weights.set(name.trim(), q === undefined ? 1 : Number(q));
    }

    return (coding) => weights.get(coding) ?? weights.get("*") ?? 0;
}

const acceptsGzip = (request: IncomingMessage): boolean =>
    encodingWeights(request.headers["accept-encoding"])("gzip") > 0;

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

/** 404 for something unknown, 400 for bad input, the `HttpError`'s own status, 500 for any other failure. */
export function answerError(response: ServerResponse, error: unknown, fallback: string): void {
    const message = error instanceof Error ? error.message : fallback;

    if (error instanceof HttpError) {
        answer(response, error.status, { error: message });
    } else if (error instanceof ActionNotFound) {
        answer(response, 404, { error: message });
    } else if (error instanceof ActionError || error instanceof URIError) {
        answer(response, 400, { error: message });
    } else {
        answer(response, 500, { error: message });
    }
}
