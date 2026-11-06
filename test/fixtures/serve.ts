// A server on a real port for a test to call: `listen` for any `node:http` server, `serve` for a route app
// behind the Node adapter the real server uses.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";

import type { ApiEnv } from "../../server/http.ts";

export type Listening = { base: string; port: number; close: () => Promise<void> };

/** How long `close` lets a response in flight finish before it cuts the connection. */
const GRACE_MS = 500;

/**
 * Binds `server` to a free port on 127.0.0.1. `close` waits for the responses in flight, so a response
 * the client never read to the end is not torn down mid-write.
 */
export async function listen(server: Server): Promise<Listening> {
    await new Promise<void>((done) => {
        server.listen(0, "127.0.0.1", done);
    });

    const address = server.address();

    assert.ok(address !== null && typeof address !== "string");

    return {
        base: `http://127.0.0.1:${String(address.port)}`,
        port: address.port,
        close: async () => {
            const closed = new Promise<void>((done) => {
                server.close(() => {
                    done();
                });
            });
            // A response still being written ends first; a stream that never ends is cut after the grace.
            const idle = setInterval(() => {
                server.closeIdleConnections();
            }, 10);
            const cut = setTimeout(() => {
                server.closeAllConnections();
            }, GRACE_MS);

            await closed;
            clearInterval(idle);
            clearTimeout(cut);
        },
    };
}

/** `c.env.incoming` and `c.env.outgoing` exist here, which `app.request()` does not give. */
export async function serve(app: Hono<ApiEnv>): Promise<Listening> {
    const listener = getRequestListener(app.fetch);

    return await listen(
        createServer((request, response) => {
            void listener(request, response);
        }),
    );
}
