import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ActionError, type Action, type Host } from "../../server/extensions.ts";
import { actions as makeActions } from "./server.ts";

void describe("git-branch settings", () => {
    let dataDir: string;
    let actions: Record<string, Action>;

    const call = (name: string, args?: unknown) => {
        const action = actions[name];

        assert.ok(action);

        return action({ args, session: null });
    };

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "git-branch-test-"));
        const host: Host = {
            name: "git-branch",
            cwd: dataDir,
            dataDir,
            log: () => {},
            onDispose: () => {},
        };

        actions = makeActions(host);
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
    });

    void it("defaults to showing the branch", async () => {
        assert.deepEqual(await call("settings"), { showInStatusBar: true });
    });

    void it("stores what is set and reads it back", async () => {
        assert.deepEqual(await call("setSettings", { showInStatusBar: false }), {
            showInStatusBar: false,
        });
        assert.deepEqual(await call("settings"), { showInStatusBar: false });
    });

    void it("rejects bad settings with an ActionError and stores nothing", async () => {
        for (const bad of [undefined, null, "x", {}, { showInStatusBar: "yes" }]) {
            await assert.rejects(async () => await call("setSettings", bad), ActionError);
        }

        assert.deepEqual(await call("settings"), { showInStatusBar: true });
    });

    void it("a broken file gives the defaults", async () => {
        await writeFile(join(dataDir, "git-branch.json"), "{not json");

        assert.deepEqual(await call("settings"), { showInStatusBar: true });
    });

    void it("the branch is null without a session folder", async () => {
        assert.equal(await call("branch"), null);
    });
});
