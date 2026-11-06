import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";

import { getRequestListener } from "@hono/node-server";

import { fileRoutes } from "../server/routes/files.ts";
import { recordOf } from "../shared/guards.ts";

/** The files app on a real port: the upload answers are read as the composer reads them. */
async function serve(dataDir: string) {
    const listener = getRequestListener(fileRoutes({ dataDir }).fetch);
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

void describe("GET /api/uploads", () => {
    void it("serves an uploaded file and nothing beside the uploads folder", async () => {
        const dataDir = await mkdtemp(join(tmpdir(), "uploads-"));

        await mkdir(join(dataDir, "uploads"));
        await mkdir(join(dataDir, "uploads-old"));
        await writeFile(join(dataDir, "uploads", "1-shot.png"), "image");
        await writeFile(join(dataDir, "uploads-old", "secret.txt"), "secret");

        const server = await serve(dataDir);

        const get = (path: string) =>
            fetch(`${server.base}/api/uploads?path=${encodeURIComponent(path)}`);

        try {
            const uploaded = await get(join(dataDir, "uploads", "1-shot.png"));

            assert.equal(uploaded.status, 200);
            assert.equal(await uploaded.text(), "image");
            assert.equal((await get(join(dataDir, "uploads-old", "secret.txt"))).status, 403);
            assert.equal((await get(join(dataDir, "uploads", "..", "x"))).status, 403);
        } finally {
            await server.close();
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});

void describe("POST /api/files", () => {
    void it("keeps two uploads of the same name apart, each holding its own bytes", async (t) => {
        const dataDir = await mkdtemp(join(tmpdir(), "uploads-"));

        await mkdir(join(dataDir, "uploads"));

        const server = await serve(dataDir);

        // The composer uploads every chosen file at once, so two `image.png` can land in the same
        // millisecond without a race to arrange: one frozen clock makes that the only case.
        t.mock.method(Date, "now", () => 1_700_000_000_000);

        const upload = async (body: string): Promise<string> => {
            const response = await fetch(`${server.base}/api/files`, {
                method: "POST",
                headers: { "x-filename": encodeURIComponent("image.png") },
                body,
            });
            const path = recordOf(await response.json())?.["path"];

            assert.equal(response.status, 201);
            assert.ok(typeof path === "string");

            return path;
        };

        try {
            const [first, second] = await Promise.all([upload("one"), upload("two")]);

            assert.notEqual(first, second, "each upload gets a file of its own");
            assert.equal(basename(first).replace(/^\d+-/, ""), "image.png");
            assert.equal(basename(second).replace(/^\d+-/, ""), "image.png");
            assert.equal(await readFile(first, "utf8"), "one");
            assert.equal(await readFile(second, "utf8"), "two");
        } finally {
            await server.close();
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});
