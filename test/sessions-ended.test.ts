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

void describe("Sessions endedAt", () => {
    void it("shows when the latest run ended, keeps it while the next run works, and survives a restart", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-ended-"));
        const model = { provider: "p", modelId: "m" };
        const models = await ModelRuntime.create();
        const open = async () => {
            const harness = await Harness.open(
                await openNodeSqliteStorage(join(dir, "state.sqlite")),
                {
                    models,
                    registry: createRegistry(),
                    env: () => new NodeExecutionEnv({ cwd: dir }),
                },
                BACKGROUND_CONTEXT,
            );

            return {
                harness,
                sessions: new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT }),
            };
        };
        let { harness, sessions } = await open();

        try {
            const id = (await sessions.create(dir)).id;
            const row = async (busy = false) =>
                (await sessions.list(() => busy)).find((summary) => summary.id === id);

            const before = await row();

            assert.ok(before !== undefined);
            assert.equal("endedAt" in before, false, "no run has ended: absent, not 0");

            await sessions.ended(id, 1_000);
            assert.equal((await row())?.endedAt, 1_000);
            assert.equal((await row(true))?.endedAt, 1_000, "a working session keeps the last end");

            await sessions.ended(id, 2_500);
            assert.equal((await row())?.endedAt, 2_500, "a second run moves it");

            await harness.close(BACKGROUND_CONTEXT);
            ({ harness, sessions } = await open());

            assert.equal((await row())?.endedAt, 2_500, "it survives a restart");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
