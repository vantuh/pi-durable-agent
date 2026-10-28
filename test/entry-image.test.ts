import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness, type EntryDraft } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { projectEntry } from "../server/projection.ts";
import { conversationRoutes } from "../server/routes/conversation.ts";
import { type Opened, Sessions } from "../server/sessions.ts";

const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

type ToolContent = Extract<
    NonNullable<EntryDraft["model"]>[number],
    { role: "toolResult" }
>["content"];

const toolResult = (content: ToolContent): EntryDraft => ({
    kind: "pi.tool-result",
    model: [
        {
            role: "toolResult",
            toolCallId: "c1",
            toolName: "read",
            content,
            isError: false,
            timestamp: 1,
        },
    ],
});

void describe("images a tool returned", () => {
    void it("reach the screen as a URL, and the URL serves the bytes of that entry only", async () => {
        const dir = await mkdtemp(join(tmpdir(), "entry-image-"));
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const sessions = new Sessions({
            harness,
            model: { provider: "p", modelId: "m" },
            models,
            context: BACKGROUND_CONTEXT,
        });
        const open: Opened[] = [];
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const route = routes.find((each) => each.path.test(url.pathname));
            const match = route?.path.exec(url.pathname);

            assert.ok(route !== undefined && match !== null && match !== undefined);
            void route.handle(request, response, url, match);
        });
        const routes = conversationRoutes({
            sessions,
            attach: (id) => Promise.resolve(open.find((each) => Number(each.id) === id)),
            rootId: () => 0,
            harness,
            stream: () => Promise.resolve(),
        }).filter((route) => route.path.test("/api/entry-image"));

        try {
            const first = await sessions.create(dir);
            const second = await sessions.create(dir);

            for (const conversation of [first, second]) {
                const opened = await sessions.open(conversation.id);

                assert.ok(opened !== undefined);
                open.push(opened);
            }

            const entries = await harness.commit(async (tx) => {
                const withImage = await tx.appendEntry(
                    first.id,
                    toolResult([
                        { type: "text", text: "Read image file [image/png]." },
                        { type: "image", data: PIXEL.toString("base64"), mimeType: "image/png" },
                        { type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
                    ]),
                );
                const textOnly = await tx.appendEntry(
                    first.id,
                    toolResult([{ type: "text", text: "no picture" }]),
                );
                const other = await tx.appendEntry(
                    second.id,
                    toolResult([{ type: "image", data: "AAAA", mimeType: "image/png" }]),
                );

                return { withImage, textOnly, other };
            }, BACKGROUND_CONTEXT);

            const projected = projectEntry(entries.withImage);

            assert.ok(projected?.kind === "toolResult");
            assert.deepEqual(
                projected.images,
                [{ mimeType: "image/png" }],
                "the picture is named, an SVG is not offered, and no bytes travel in the event",
            );
            assert.ok(!JSON.stringify(projected).includes(PIXEL.toString("base64")));

            const projectedText = projectEntry(entries.textOnly);

            assert.ok(projectedText?.kind === "toolResult");
            assert.equal(projectedText.images, undefined);

            await new Promise<void>((done) => {
                server.listen(0, "127.0.0.1", done);
            });

            const address = server.address();

            assert.ok(address !== null && typeof address !== "string");

            const get = (session: number, entry: number, index: number) =>
                fetch(
                    `http://127.0.0.1:${String(address.port)}/api/entry-image?session=${String(session)}&entry=${String(entry)}&index=${String(index)}`,
                );

            const served = await get(first.id, Number(entries.withImage.id), 0);

            assert.equal(served.status, 200);
            assert.equal(served.headers.get("content-type"), "image/png");
            assert.equal(served.headers.get("x-content-type-options"), "nosniff");
            assert.deepEqual(Buffer.from(await served.arrayBuffer()), PIXEL);

            assert.equal((await get(first.id, Number(entries.withImage.id), 1)).status, 404);
            assert.equal((await get(first.id, Number(entries.textOnly.id), 0)).status, 404);
            assert.equal(
                (await get(first.id, Number(entries.other.id), 0)).status,
                404,
                "another conversation's entry is not served under this session",
            );
            assert.equal((await get(first.id, Number(entries.withImage.id), -1)).status, 400);
        } finally {
            server.closeAllConnections();
            await new Promise<void>((done) => {
                server.close(() => {
                    done();
                });
            });
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
