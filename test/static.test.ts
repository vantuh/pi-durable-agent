import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { serveStatic } from "../server/static.ts";

void describe("static serving", () => {
    let dir: string;
    let base: string;
    let port: number;
    let close: () => Promise<void>;

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), "static-"));
        const root = join(dir, "dist");
        await mkdir(join(root, "assets"), { recursive: true });
        await writeFile(join(root, "index.html"), "<p>shell</p>");
        await writeFile(join(root, "sw.js"), "worker");
        await writeFile(join(root, "manifest.webmanifest"), "{}");
        await writeFile(join(root, "assets", "app-abc123.js"), "code");
        await writeFile(join(root, "assets", "font-abc123.woff2"), "font");
        await writeFile(join(dir, "secret.txt"), "secret");
        const server = createServer((request, response) => {
            void serveStatic(root, request, response);
        });
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        const address = server.address();
        assert.ok(address !== null && typeof address === "object");
        port = address.port;
        base = `http://127.0.0.1:${port}`;
        close = () => new Promise((done) => server.close(() => done()));
    });

    after(async () => {
        await close();
        await rm(dir, { recursive: true, force: true });
    });

    // `fetch` normalises `..`, so traversal is sent as a raw request line.
    const raw = (path: string): Promise<{ status: number; body: string }> =>
        new Promise((done, fail) => {
            const req = httpRequest({ host: "127.0.0.1", port, path }, (res) => {
                let body = "";
                res.on("data", (chunk: Buffer) => (body += chunk.toString()));
                res.on("end", () => done({ status: res.statusCode ?? 0, body }));
            });
            req.on("error", fail);
            req.end();
        });

    void it("serves index.html at / without caching it", async () => {
        const res = await fetch(`${base}/`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(res.headers.get("cache-control"), "no-cache");
        assert.equal(await res.text(), "<p>shell</p>");
    });

    void it("serves the worker and manifest with revalidation and their types", async () => {
        const worker = await fetch(`${base}/sw.js`);
        assert.equal(worker.headers.get("content-type"), "text/javascript; charset=utf-8");
        assert.equal(worker.headers.get("cache-control"), "no-cache");

        const manifest = await fetch(`${base}/manifest.webmanifest`);
        assert.equal(manifest.headers.get("content-type"), "application/manifest+json");
    });

    void it("caches hashed assets for good", async () => {
        const js = await fetch(`${base}/assets/app-abc123.js`);
        assert.equal(js.headers.get("cache-control"), "public, max-age=31536000, immutable");
        assert.equal(await js.text(), "code");

        const font = await fetch(`${base}/assets/font-abc123.woff2`);
        assert.equal(font.headers.get("content-type"), "font/woff2");
    });

    void it("answers HEAD with headers and no body", async () => {
        const res = await fetch(`${base}/sw.js`, { method: "HEAD" });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-length"), "6");
        assert.equal(await res.text(), "");
    });

    void it("rejects other methods with 405", async () => {
        const res = await fetch(`${base}/`, { method: "POST", body: "x" });
        assert.equal(res.status, 405);
        assert.equal(res.headers.get("allow"), "GET, HEAD");
    });

    void it("does not fall back to index.html for a missing file", async () => {
        assert.equal((await fetch(`${base}/nope`)).status, 404);
        assert.equal((await fetch(`${base}/assets`)).status, 404);
    });

    void it("refuses paths that leave the root", async () => {
        for (const path of [
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/assets/..%2f..%2fsecret.txt",
        ]) {
            const res = await raw(path);
            assert.equal(res.status, 404, path);
            assert.ok(!res.body.includes("secret"), path);
        }

        assert.equal((await raw("/%00")).status, 400);
        assert.equal((await raw("/%E0%A4%A")).status, 400);
    });
});
