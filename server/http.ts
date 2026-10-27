/** Reading requests and writing JSON answers: what every route of the server does the same way. */

import type { IncomingMessage, ServerResponse } from "node:http";

import { ActionError, ActionNotFound } from "./extensions.ts";

const MAX_BODY = 100_000_000;

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

/** The parsed body, or `undefined` for an empty one. */
export async function readJson(request: IncomingMessage): Promise<unknown> {
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

export function answer(response: ServerResponse, status: number, payload: unknown): void {
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

    response.writeHead(code, { "content-type": "application/json" });
    response.end(text);
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
