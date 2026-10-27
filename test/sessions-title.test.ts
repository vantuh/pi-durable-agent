import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

void describe("Sessions.title", () => {
    void it("names a session as the list does, so an extension and the sidebar cannot disagree", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-title-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
            BACKGROUND_CONTEXT,
        );
        const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });
        const listed = async (id: number): Promise<string | null | undefined> =>
            (await sessions.list(() => false)).find((row) => row.id === id)?.title;

        try {
            const asked = await sessions.create(dir);
            const silent = await sessions.create(dir);

            await harness.commit(async (tx) => {
                await tx.appendEntry(asked.id, {
                    kind: "pi.user",
                    data: { text: "why does the fold close" },
                });
                await tx.appendEntry(asked.id, {
                    kind: "pi.user",
                    data: { text: "and why did it open" },
                });
            }, BACKGROUND_CONTEXT);

            // The first question names it; a later one does not rename it.
            assert.equal(await sessions.title(asked.id), "why does the fold close");
            assert.equal(await listed(asked.id), "why does the fold close");

            await sessions.setTitle(asked.id, "mcp plugin");

            assert.equal(await sessions.title(asked.id), "mcp plugin", "the written name wins");
            assert.equal(await listed(asked.id), "mcp plugin", "and the list shows the same name");

            await sessions.setTitle(asked.id, "");

            assert.equal(
                await sessions.title(asked.id),
                "why does the fold close",
                "an empty name goes back to the question",
            );
            assert.equal(await listed(asked.id), "why does the fold close");

            assert.equal(await sessions.title(silent.id), null, "nothing asked, nothing named");
            assert.equal(await listed(silent.id), null);
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
