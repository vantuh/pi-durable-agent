import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { serveStatic } from "../server/static.ts";
import { listen } from "./fixtures/serve.ts";

const BIG = "export const line = 'compressible text';\n".repeat(200);

void describe("static serving", () => {
    let dir: string;
    let root: string;
    let base: string;
    let port: number;
    let close: () => Promise<void>;

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), "static-"));
        root = join(dir, "dist");
        await mkdir(join(root, "assets"), { recursive: true });
        await writeFile(join(root, "index.html"), "<p>shell</p>");
        await writeFile(join(root, "sw.js"), "worker");
        await writeFile(join(root, "manifest.webmanifest"), "{}");
        await writeFile(join(root, "assets", "app-abc123.js"), "code");
        await writeFile(join(root, "assets", "font-abc123.woff2"), "font");
        await writeFile(join(root, "assets", "big-abc123.js"), BIG);
        await writeFile(join(root, "assets", "font-big.woff2"), BIG);
        await writeFile(join(dir, "secret.txt"), "secret");
        const server = createServer((request, response) => {
            void serveStatic(root, request, response);
        });
        ({ port, base, close } = await listen(server));
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

    const rawFile = (
        path: string,
        headers: Record<string, string> = {},
        method = "GET",
    ): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> =>
        new Promise((done, fail) => {
            const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () =>
                    done({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                    }),
                );
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

    void it("gzips a text asset for a client that accepts gzip", async () => {
        const res = await rawFile("/assets/big-abc123.js", { "accept-encoding": "gzip" });
        assert.equal(res.status, 200);
        assert.equal(res.headers["content-encoding"], "gzip");
        assert.equal(res.headers["vary"], "accept-encoding");
        assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
        assert.equal(res.headers["content-length"], String(res.body.length));
        assert.ok(res.body.length < BIG.length);
        assert.equal(gunzipSync(res.body).toString(), BIG);
    });

    void it("prefers brotli, and honours q=0", async () => {
        const br = await rawFile("/assets/big-abc123.js", { "accept-encoding": "gzip, br" });
        assert.equal(br.headers["content-encoding"], "br");
        assert.equal(br.headers["content-length"], String(br.body.length));
        assert.equal(brotliDecompressSync(br.body).toString(), BIG);

        const refused = await rawFile("/assets/big-abc123.js", {
            "accept-encoding": "br;q=0, gzip;q=0.5",
        });
        assert.equal(refused.headers["content-encoding"], "gzip");

        const none = await rawFile("/assets/big-abc123.js", {
            "accept-encoding": "br;q=0, gzip;q=0",
        });
        assert.equal(none.headers["content-encoding"], undefined);
    });

    void it("sends the file as it is when no encoding is accepted", async () => {
        for (const headers of [{}, { "accept-encoding": "identity" }]) {
            const res = await rawFile("/assets/big-abc123.js", headers);
            assert.equal(res.headers["content-encoding"], undefined);
            assert.equal(res.headers["vary"], "accept-encoding");
            assert.equal(res.headers["content-length"], String(BIG.length));
            assert.equal(res.body.toString(), BIG);
        }
    });

    void it("leaves already compressed types alone", async () => {
        const res = await rawFile("/assets/font-big.woff2", { "accept-encoding": "br, gzip" });
        assert.equal(res.headers["content-encoding"], undefined);
        assert.equal(res.headers["vary"], undefined);
        assert.equal(res.body.toString(), BIG);
    });

    void it("answers HEAD with the compressed headers and no body", async () => {
        const get = await rawFile("/assets/big-abc123.js", { "accept-encoding": "gzip" });
        const head = await rawFile("/assets/big-abc123.js", { "accept-encoding": "gzip" }, "HEAD");
        assert.equal(head.status, 200);
        assert.equal(head.headers["content-encoding"], "gzip");
        assert.equal(head.headers["content-length"], String(get.body.length));
        assert.equal(head.body.length, 0);
    });

    void it("keeps compressed bytes per file, size and mtime", async () => {
        const path = join(root, "assets", "cached-abc123.js");
        const ask = () => rawFile("/assets/cached-abc123.js", { "accept-encoding": "gzip" });
        const text = (res: { body: Buffer }) => gunzipSync(res.body).toString();
        const first = "a".repeat(2000);

        const mtime = new Date(1_700_000_000_000);

        await writeFile(path, first);
        await utimes(path, mtime, mtime);
        const one = await ask();
        const two = await ask();
        assert.deepEqual(two.body, one.body);

        // Same size and mtime: the cache cannot tell the file changed, which is what proves it is used.
        await writeFile(path, "b".repeat(2000));
        await utimes(path, mtime, mtime);
        assert.equal(text(await ask()), first);

        await utimes(path, mtime, new Date(mtime.getTime() + 5000));
        assert.equal(text(await ask()), "b".repeat(2000));
    });

    void it("compresses the revalidated files too and serves a rebuild fresh", async () => {
        const page = join(root, "index.html");
        const worker = join(root, "sw.js");
        const html = `<p>${"shell ".repeat(300)}</p>`;
        const code = "precache();\n".repeat(300);
        const ask = (path: string) => rawFile(path, { "accept-encoding": "br" });

        await writeFile(page, html);
        await writeFile(worker, code);
        const shell = await ask("/");
        assert.equal(shell.headers["cache-control"], "no-cache");
        assert.equal(shell.headers["content-encoding"], "br");
        assert.equal(brotliDecompressSync(shell.body).toString(), html);
        const sw = await ask("/sw.js");
        assert.equal(sw.headers["content-encoding"], "br");
        assert.equal(brotliDecompressSync(sw.body).toString(), code);

        const rebuilt = `${html}<p>new build</p>`;
        await writeFile(page, rebuilt);
        const fresh = await ask("/");
        assert.equal(brotliDecompressSync(fresh.body).toString(), rebuilt);
        assert.equal(fresh.headers["content-length"], String(fresh.body.length));
    });

    void it("does not compress a file that would grow", async () => {
        const res = await rawFile("/manifest.webmanifest", { "accept-encoding": "br" });
        assert.equal(res.headers["content-encoding"], undefined);
        assert.equal(res.headers["content-length"], "2");
        assert.equal(res.body.toString(), "{}");
    });
});
