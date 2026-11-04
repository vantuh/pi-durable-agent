import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { Sessions } from "../server/sessions.ts";

void it("moves a session to another folder, and the agent resolves there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessions-cwd-"));
    const models = await ModelRuntime.create();
    const model = { provider: "openai", modelId: "gpt-6.1-sol" };
    const harness = await Harness.open(
        await openNodeSqliteStorage(join(dir, "state.sqlite")),
        { models, registry: createRegistry(), env: () => new NodeExecutionEnv({ cwd: dir }) },
        BACKGROUND_CONTEXT,
    );

    try {
        const sessions = new Sessions({ harness, model, models, context: BACKGROUND_CONTEXT });
        const conversation = await sessions.create(join(dir, "main"));
        const id = conversation.id;

        await sessions.setCwd(id, join(dir, "linked"));

        assert.equal((await sessions.row(id, false))?.cwd, join(dir, "linked"));
        assert.equal((await conversation.agent(BACKGROUND_CONTEXT)).cwd, join(dir, "linked"));
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
        await rm(dir, { recursive: true, force: true });
    }
});
