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

void describe("Sessions.ids", () => {
    void it("lists every conversation, past one page of 100", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-ids-"));
        const model = { provider: "p", modelId: "m" };
        const harness = await Harness.open(
            await openNodeSqliteStorage(join(dir, "state.sqlite")),
            {
                models: await ModelRuntime.create(),
                registry: createRegistry(),
                env: () => new NodeExecutionEnv({ cwd: dir }),
            },
            BACKGROUND_CONTEXT,
        );

        try {
            const sessions = new Sessions({
                harness,
                model,
                context: BACKGROUND_CONTEXT,
            });

            const first = await sessions.create(dir);

            for (let count = 0; count < 120; count += 1) {
                await harness.createConversation(
                    { ownership: { kind: "ownerless" }, agent: { model, cwd: dir } },
                    BACKGROUND_CONTEXT,
                );
            }

            assert.equal(
                (await sessions.list(() => false)).find((row) => row.id === first.id)?.archived,
                false,
            );
            await sessions.setArchived(first.id, true);
            const reopened = new Sessions({
                harness,
                model,
                context: BACKGROUND_CONTEXT,
            });
            assert.equal(
                (await reopened.list(() => false)).find((row) => row.id === first.id)?.archived,
                true,
            );
            assert.ok(await reopened.open(first.id), "archived conversations remain accessible");
            await reopened.setArchived(first.id, false);
            assert.equal(
                (await sessions.list(() => false)).find((row) => row.id === first.id)?.archived,
                false,
            );

            const ids = await sessions.ids();

            assert.equal(ids.length, 121);
            assert.equal(new Set(ids).size, 121);
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
