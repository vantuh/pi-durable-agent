/** The few HTTP lines this extension needs: an extension may take core server code only from `sdk.ts`. */

import type { IncomingMessage, ServerResponse } from "node:http";

/** An answer the browser gets as `{ error }` with this status; `actions.ts` and the routes read it. */
export class HttpError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** A part is 400 KB of base64 at most: past this, the page is sending something it does not mean to. */
const MAX_BODY = 4 * 1024 * 1024;

/** The parsed body of a request, or `undefined` for an empty one. */
export function readJson(request: IncomingMessage): Promise<unknown> {
    return new Promise((done, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        request.on("data", (chunk: Buffer) => {
            size += chunk.length;

            if (size > MAX_BODY) {
                request.destroy();
                reject(new HttpError(413, "That part is too large."));

                return;
            }

            chunks.push(chunk);
        });
        request.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");

            if (text === "") {
                done(undefined);

                return;
            }

            try {
                done(JSON.parse(text));
            } catch {
                reject(new HttpError(400, "The body is not JSON."));
            }
        });
        request.on("error", reject);
    });
}

export function record(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }

    return Object.fromEntries(Object.entries(value));
}

export function answer(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
}

/** An `HttpError` keeps its status; anything else is this server's own failure. */
export function answerError(response: ServerResponse, error: unknown): void {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "the dictation request failed";

    answer(response, status, { error: message });
}
