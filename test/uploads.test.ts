import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { fileRoutes } from "../server/routes/files.ts";

void describe("GET /api/uploads", () => {
    void it("serves an uploaded file and nothing beside the uploads folder", async () => {
        const dataDir = await mkdtemp(join(tmpdir(), "uploads-"));
        const route = fileRoutes({ dataDir }).find(
            (each) => each.method === "GET" && each.path.test("/api/uploads"),
        );
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const match = route?.path.exec(url.pathname);

            assert.ok(route !== undefined && match !== null && match !== undefined);
            void route.handle(request, response, url, match);
        });

        await mkdir(join(dataDir, "uploads"));
        await mkdir(join(dataDir, "uploads-old"));
        await writeFile(join(dataDir, "uploads", "1-shot.png"), "image");
        await writeFile(join(dataDir, "uploads-old", "secret.txt"), "secret");
        await new Promise<void>((done) => {
            server.listen(0, "127.0.0.1", done);
        });

        const address = server.address();

        assert.ok(address !== null && typeof address !== "string");

        const get = (path: string) =>
            fetch(
                `http://127.0.0.1:${String(address.port)}/api/uploads?path=${encodeURIComponent(path)}`,
            );

        try {
            const uploaded = await get(join(dataDir, "uploads", "1-shot.png"));

            assert.equal(uploaded.status, 200);
            assert.equal(await uploaded.text(), "image");
            assert.equal((await get(join(dataDir, "uploads-old", "secret.txt"))).status, 403);
            assert.equal((await get(join(dataDir, "uploads", "..", "x"))).status, 403);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((done) => {
                server.close(() => {
                    done();
                });
            });
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});
