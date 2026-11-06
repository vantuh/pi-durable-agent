// A route app on a real port, behind the Node adapter the server uses: `c.env.incoming` and `c.env.outgoing`
// exist, which `app.request()` does not give.
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";

import type { ApiEnv } from "../../server/http.ts";

export async function serve(
    app: Hono<ApiEnv>,
): Promise<{ base: string; close: () => Promise<void> }> {
    const listener = getRequestListener(app.fetch);
    const server = createServer((request, response) => {
        void listener(request, response);
    });

    await new Promise<void>((done) => {
        server.listen(0, "127.0.0.1", done);
    });

    const address = server.address();

    assert.ok(address !== null && typeof address !== "string");

    return {
        base: `http://127.0.0.1:${String(address.port)}`,
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((done) => {
                server.close(() => {
                    done();
                });
            });
        },
    };
}
