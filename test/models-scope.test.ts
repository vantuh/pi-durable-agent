import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { enabledModels, scopedModels } from "../server/routes/models.ts";

const model = (provider: string, id: string) => ({ provider, id });
const catalog = [
    model("openai", "gpt-6-sol"),
    model("amazon-bedrock", "nova-v1:0"),
    model("cursor", "grok-4.7@256k"),
    model("kiro-acp", "auto"),
];
const available = [model("openai", "gpt-6-sol"), model("kiro-acp", "auto")];

void test("with no enabledModels, the models that have credentials are the scope", () => {
    assert.deepEqual(scopedModels(undefined, catalog, available), available);
});

void test("an enabled model that has no credentials is scoped all the same", () => {
    assert.deepEqual(scopedModels(["amazon-bedrock/nova-v1:0"], catalog, available), [
        model("amazon-bedrock", "nova-v1:0"),
    ]);
});

void test("a thinking level or a colon in the id still matches its model", () => {
    const scoped = scopedModels(
        ["cursor/grok-4.7@256k:slow", "amazon-bedrock/nova-v1:0"],
        catalog,
        available,
    );

    assert.deepEqual(scoped, [
        model("amazon-bedrock", "nova-v1:0"),
        model("cursor", "grok-4.7@256k"),
    ]);
});

void test("the settings are read from the agent dir a save writes to", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-models-scope-"));
    const previous = process.env["PI_CODING_AGENT_DIR"];

    try {
        await writeFile(
            join(agentDir, "settings.json"),
            JSON.stringify({ enabledModels: ["kiro-acp/auto"] }),
        );
        process.env["PI_CODING_AGENT_DIR"] = agentDir;

        assert.deepEqual(enabledModels(), ["kiro-acp/auto"]);
    } finally {
        if (previous === undefined) {
            delete process.env["PI_CODING_AGENT_DIR"];
        } else {
            process.env["PI_CODING_AGENT_DIR"] = previous;
        }

        await rm(agentDir, { recursive: true, force: true });
    }
});
