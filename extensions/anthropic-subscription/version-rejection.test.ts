import assert from "node:assert/strict";
import { test } from "node:test";

import type { Diagnostics } from "./refs.ts";
import { hintedResponse, readVersionRejection, recoveryHint } from "./version-rejection.ts";

export function rejected(required = "2.1.300"): Response {
    return new Response(
        JSON.stringify({
            type: "error",
            request_id: "request-test",
            error: {
                type: "invalid_request_error",
                details: { error_code: "claude_code_version_too_old" },
                message: `Claude Code 2.1.280 does not support this model; version ${required} or newer is required.`,
            },
        }),
        {
            status: 400,
            headers: { "request-id": "request-test", "content-type": "application/json" },
        },
    );
}

void test("only the structured version error is explained, preserving error and request identity", async () => {
    const response = rejected();
    const rejection = await readVersionRejection(response);
    assert.ok(rejection);
    assert.equal(rejection.requiredVersion, "2.1.300");
    const state: Diagnostics = {
        version: "2.1.280",
        source: "default",
        transportVersion: null,
        learnedFloor: null,
        lastRetry: "none",
        versionError: null,
        last: null,
    };
    const result = await hintedResponse(
        response,
        rejection,
        recoveryHint("2.1.300", false, "2.1.280"),
        state,
    );
    assert.equal(result.status, 400);
    assert.equal(result.headers.get("request-id"), "request-test");
    const text = await result.text();
    assert.match(text, /claude_code_version_too_old/);
    assert.match(text, /Update Pi/);
    assert.match(text, /2.1.300/);
    assert.equal(state.versionError?.requiredVersion, "2.1.300");
    assert.match(recoveryHint("2.1.300", true, "2.1.200"), /2.1.200 is explicit/);
});

void test("unrelated, malformed and successful responses are not consumed or modified", async () => {
    for (const response of [
        new Response("stream"),
        new Response("bad JSON", { status: 400 }),
        new Response(JSON.stringify({ error: { message: "version 9.0.0 or newer is required" } }), {
            status: 400,
        }),
        new Response("rate limit", { status: 429 }),
    ]) {
        assert.equal(await readVersionRejection(response), undefined);
        assert.equal(response.bodyUsed, false);
        assert.ok((await response.text()).length > 0);
    }
});

void test("unknown wording does not invent a required floor", async () => {
    const response = new Response(
        JSON.stringify({
            error: {
                details: { error_code: "claude_code_version_too_old" },
                message: "New wording",
            },
        }),
        { status: 400 },
    );
    assert.equal((await readVersionRejection(response))?.requiredVersion, null);
});
