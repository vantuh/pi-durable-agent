import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createRegistry } from "@earendil-works/pi-durable";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";

import { ActionNotFound } from "../server/errors.ts";
import { Extensions } from "../server/extensions/extensions.ts";
import type { ApiEnv } from "../server/http.ts";
import { extensionRoutes } from "../server/routes/extensions.ts";
import { sameOrigin } from "../server/same-origin.ts";
import { recordOf } from "../shared/guards.ts";
import { serve } from "./fixtures/serve.ts";

void describe("extension HTTP", () => {
    let root: string;
    let extensions: Extensions;
    let base: string;
    let close: () => Promise<void>;
    const module = (text: string) => `export default host => ({name:host.name});
        export const http = host => ({response,path}) => {response.end(${JSON.stringify(text)} + host.name + path);};`;
    const write = (text: string) => writeFile(join(root, "sample", "server.ts"), text);
    /** An extension's HTTP handler that answers with the path it was handed, and the body's size and hash. */
    const echo = `import { createHash } from "node:crypto";
        export default host => ({name: host.name});
        export const http = () => ({request, response, path}) => {
            const chunks = [];
            request.on("data", (chunk) => chunks.push(chunk));
            request.on("end", () => {
                const body = Buffer.concat(chunks);
                response.writeHead(200, {"content-type": "application/json"});
                response.end(JSON.stringify({
                    path,
                    length: body.length,
                    sha: createHash("sha256").update(body).digest("hex"),
                }));
            });
        };`;
    /** The extension routes on a real port: the Hono adapter is part of what is under test. */
    async function serveRoutes(): Promise<{ base: string; close: () => Promise<void> }> {
        const listener = getRequestListener(
            extensionRoutes({
                extensions,
                attach: () => Promise.resolve(undefined),
                ownerOf: () => Promise.resolve(undefined),
            }).fetch,
        );
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
                    server.close(() => done());
                });
            },
        };
    }
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "extension-http-"));
        await mkdir(join(root, "sample"));
        extensions = new Extensions({
            registry: createRegistry(),
            dir: root,
            cwd: root,
            dataDir: root,
            log() {},
        });
        const server = createServer((request, response) => {
            void extensions
                .serveHttp("sample", { request, response, path: request.url ?? "/" })
                .catch((error: unknown) => {
                    response.writeHead(error instanceof ActionNotFound ? 404 : 500);
                    response.end();
                });
        });
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.ok(address !== null && typeof address !== "string");
        base = `http://127.0.0.1:${String(address.port)}`;
        close = () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
    });
    afterEach(async () => {
        await close();
        await extensions.dispose();
        await rm(root, { recursive: true, force: true });
    });
    void it("follows reload, last-good failure, disabling and removal", async () => {
        await write(module("one:"));
        await extensions.load();
        assert.equal(await (await fetch(base + "/stream?q=1")).text(), "one:sample/stream?q=1");
        await write(module("two:"));
        await extensions.load();
        assert.equal(await (await fetch(base)).text(), "two:sample/");
        await write("export default host => ({name:host.name}); export const http = () => 42;");
        await extensions.load();
        assert.equal(await (await fetch(base)).text(), "two:sample/");
        assert.match(extensions.failed[0]?.reason ?? "", /http factory/);
        await extensions.setEnabled("sample", false);
        assert.equal((await fetch(base)).status, 404);
        await write(module("three:"));
        await extensions.setEnabled("sample", true);
        assert.equal(await (await fetch(base)).text(), "three:sample/");
        await rm(join(root, "sample"), { recursive: true });
        await extensions.load();
        assert.equal((await fetch(base)).status, 404);
    });
    void it("drops the handler when a replacement installs nothing", async () => {
        await write(module("one:"));
        await extensions.load();
        await write("export default () => undefined;");
        await extensions.load();
        assert.equal((await fetch(base)).status, 404);
    });
    void it("hands an extension the whole body of a POST, and its path and query", async () => {
        // The app answers through Hono while the extension reads the raw request: the body must arrive whole.
        await write(echo);
        await extensions.load();

        const server = await serveRoutes();
        const body = Buffer.from("pcm-".repeat(400_000));

        try {
            const response = await fetch(`${server.base}/api/extensions/sample/http/audio?x=1`, {
                method: "POST",
                body,
            });
            const answer = recordOf(await response.json());

            assert.equal(response.status, 200);
            assert.equal(answer?.["path"], "/audio?x=1");
            assert.equal(answer?.["length"], body.length);
            assert.equal(answer?.["sha"], createHash("sha256").update(body).digest("hex"));
        } finally {
            await server.close();
        }
    });
    void it("hands an extension the path bytes the browser sent, still encoded", async () => {
        await write(echo);
        await extensions.load();

        const server = await serveRoutes();

        try {
            const response = await fetch(
                `${server.base}/api/extensions/sample/http/a%20b/%E2%82%AC/%61?x=1`,
            );

            assert.equal(response.status, 200);
            assert.equal(
                recordOf(await response.json())?.["path"],
                "/a%20b/%E2%82%AC/%61?x=1",
                "the extension decodes its own path: it gets the bytes the browser sent",
            );
        } finally {
            await server.close();
        }
    });
    void it("refuses an escape it cannot decode in an extension's name or action", async () => {
        await write(echo);
        await extensions.load();

        const server = await serveRoutes();

        try {
            const action = await fetch(`${server.base}/api/extensions/sample/actions/bad%ZZ`, {
                method: "POST",
                body: "{}",
            });

            assert.equal(action.status, 400);
            assert.deepEqual(await action.json(), { error: "URI malformed" });

            const toggle = await fetch(`${server.base}/api/extensions/bad%ZZ`, {
                method: "PUT",
                body: JSON.stringify({ enabled: false }),
            });

            assert.equal(toggle.status, 400);
            assert.deepEqual(await toggle.json(), { error: "URI malformed" });
        } finally {
            await server.close();
        }
    });
    void it("does not mark the session an extension request names as changed", async () => {
        // An extension changes a row only through the host: its request body is not the list's business.
        const marked: (number | undefined)[] = [];
        const app = new Hono<ApiEnv>()
            .use("*", async (c, next) => {
                await next();
                marked.push(c.get("changedSession"));
            })
            .route(
                "/",
                extensionRoutes({
                    extensions,
                    attach: () => Promise.resolve(undefined),
                    ownerOf: () => Promise.resolve(undefined),
                }),
            );
        const server = await serve(app);

        try {
            const action = await fetch(`${server.base}/api/extensions/sample/actions/go`, {
                method: "POST",
                body: JSON.stringify({ session: 7 }),
            });
            const toggle = await fetch(`${server.base}/api/extensions/sample`, {
                method: "PUT",
                body: JSON.stringify({ session: 7 }),
            });

            // Both name a valid session; one finds no such session, the other has no `enabled`.
            assert.equal(action.status, 404);
            assert.equal(toggle.status, 400);
            assert.deepEqual(marked, [undefined, undefined]);
        } finally {
            await server.close();
        }
    });
    void it("rejects foreign origins without rejecting an HTTPS reverse proxy", () => {
        assert.equal(
            sameOrigin({
                host: "agent.example",
                origin: "https://agent.example",
                "sec-fetch-site": "same-origin",
            }),
            true,
        );
        assert.equal(sameOrigin({ host: "localhost:5190", origin: "http://localhost:5190" }), true);
        assert.equal(sameOrigin({ host: "localhost:5190" }), true);
        assert.equal(sameOrigin({ host: "localhost:5190", origin: "null" }), false);
        assert.equal(sameOrigin({ host: "localhost:5190", origin: "https://evil.example" }), false);
        assert.equal(sameOrigin({ host: "localhost:5190", "sec-fetch-site": "cross-site" }), false);
        assert.equal(sameOrigin({ host: "agent.example", "sec-fetch-site": "same-site" }), false);
    });
});
