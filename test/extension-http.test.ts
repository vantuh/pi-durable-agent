import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createRegistry } from "@earendil-works/pi-durable";

import { extensionHttpAllowed } from "../server/extension-http.ts";
import { ActionNotFound, Extensions } from "../server/extensions.ts";

void describe("extension HTTP", () => {
    let root: string;
    let extensions: Extensions;
    let base: string;
    let close: () => Promise<void>;
    const module = (text: string) => `export default host => ({name:host.name});
        export const http = host => ({response,path}) => {response.end(${JSON.stringify(text)} + host.name + path);};`;
    const write = (text: string) => writeFile(join(root, "sample", "server.ts"), text);
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
    void it("rejects foreign origins without rejecting an HTTPS reverse proxy", () => {
        assert.equal(
            extensionHttpAllowed({
                host: "agent.example",
                origin: "https://agent.example",
                "sec-fetch-site": "same-origin",
            }),
            true,
        );
        assert.equal(
            extensionHttpAllowed({ host: "localhost:5190", origin: "http://localhost:5190" }),
            true,
        );
        assert.equal(extensionHttpAllowed({ host: "localhost:5190" }), true);
        assert.equal(extensionHttpAllowed({ host: "localhost:5190", origin: "null" }), false);
        assert.equal(
            extensionHttpAllowed({ host: "localhost:5190", origin: "https://evil.example" }),
            false,
        );
        assert.equal(
            extensionHttpAllowed({ host: "localhost:5190", "sec-fetch-site": "cross-site" }),
            false,
        );
        assert.equal(
            extensionHttpAllowed({ host: "agent.example", "sec-fetch-site": "same-site" }),
            false,
        );
    });
});
