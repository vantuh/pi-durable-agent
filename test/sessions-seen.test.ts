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

void describe("Sessions unseen", () => {
    void it("is one state on the server: a seen run stays seen, also after a restart", async () => {
        const dir = await mkdtemp(join(tmpdir(), "sessions-seen-"));
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
            const unseen = async (busy = false): Promise<boolean | undefined> =>
                (await sessions.list(() => busy)).find((row) => row.id === id)?.unseen;

            assert.equal(await unseen(), false, "no run has ended");

            await sessions.ended(id, Date.now());

            assert.equal(await unseen(), true, "a run ended nobody saw");
            assert.equal(await unseen(true), false, "a working session is not fresh");

            await sessions.setArchived(id, true);
            assert.equal(await unseen(), false, "an archived session is never fresh");
            await sessions.setArchived(id, false);

            await harness.close(BACKGROUND_CONTEXT);
            ({ harness, sessions } = await open());

            assert.equal(await unseen(), true, "the mark survives a restart");

            const ended = Date.now();

            await sessions.seen(id);
            assert.equal(await unseen(), false, "seen on one device is seen everywhere");

            await harness.close(BACKGROUND_CONTEXT);
            ({ harness, sessions } = await open());

            assert.equal(await unseen(), false, "and stays seen after a restart");

            await sessions.ended(id, ended + 60_000);
            assert.equal(await unseen(), true, "a later run is fresh again");
        } finally {
            await harness.close(BACKGROUND_CONTEXT);
            await rm(dir, { recursive: true, force: true });
        }
    });
});
