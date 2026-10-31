import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executionEnv } from "../server/execution-env.ts";

/** The folder an environment runs in, or undefined for one that does not say. */
function folderOf(env: unknown): unknown {
    return typeof env === "object" && env !== null ? Reflect.get(env, "cwd") : undefined;
}

void describe("executionEnv", () => {
    void it("runs a conversation's tools in the conversation's own folder", () => {
        assert.equal(
            folderOf(executionEnv("/app")({ cwd: "/repo/worktrees/try-it" })),
            "/repo/worktrees/try-it",
        );
    });

    void it("falls back to the app's folder for a conversation that has none", () => {
        assert.equal(folderOf(executionEnv("/app")({})), "/app");
    });
});
