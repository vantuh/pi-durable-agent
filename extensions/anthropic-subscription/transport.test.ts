import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelFetch } from "../../server/model-requests.ts";
import { type Diagnostics } from "./refs.ts";
import { shapeRequest } from "./server.ts";
import { oauthTransport, requestFrom } from "./transport.ts";
import { higherVersion } from "./version.ts";

const payload = {
    system: [{ type: "text", text: "Project rules" }],
    messages: [{ role: "user", content: "hello" }],
};

function state(): Diagnostics {
    return {
        version: "2.1.280",
        source: "default",
        transportVersion: null,
        learnedFloor: null,
        lastRetry: "none",
        versionError: null,
        last: null,
    };
}

void test("billing version follows the newer Pi User-Agent without altering HTTP identity", async () => {
    for (const [ua, expected] of [
        ["claude-cli/2.1.300 (external, cli)", "2.1.300"],
        ["claude-cli/2.1.99", "2.1.280"],
        ["unexpected", "2.1.280"],
    ]) {
        const diagnostics = state();
        const next: ModelFetch = async (input, init) => {
            const request = requestFrom(input, init);
            const sent: unknown = await request.json();
            assert.equal(request.headers.get("user-agent"), ua);
            assert.match(
                JSON.stringify(sent),
                new RegExp(`cc_version=${expected?.replaceAll(".", "\\.")}\\.`),
            );
            assert.equal(request.headers.get("content-length"), null);
            return new Response("ok");
        };
        const wrapped = oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
            version: "2.1.280",
            override: false,
        });
        await wrapped("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                authorization: "Bearer sk-ant-oat-test",
                "user-agent": ua ?? "",
                "content-length": "1",
            },
            body: JSON.stringify(payload),
        });
        assert.equal(diagnostics.version, expected);
        assert.equal(diagnostics.source, expected === "2.1.280" ? "default" : "transport");
    }
});

void test("explicit version override is absolute and non-OAuth requests remain byte-identical", async () => {
    const diagnostics = state();
    let body = "";
    const next: ModelFetch = async (input, init) => {
        body = await requestFrom(input, init).text();
        return new Response("ok");
    };
    const wrapped = oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
        version: "2.1.200",
        override: true,
    });
    const make = (oauth: boolean) =>
        new Request("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                authorization: oauth ? "Bearer sk-ant-oat-test" : "Bearer other-token",
                "user-agent": "claude-cli/2.1.400",
            },
            body: JSON.stringify(payload),
        });
    await wrapped(make(true));
    assert.match(body, /cc_version=2\.1\.200\./);
    assert.equal(diagnostics.source, "environment");
    await wrapped(make(false));
    assert.equal(body, JSON.stringify(payload));
});

void test("numeric ordering handles multi-digit versions", () => {
    assert.equal(higherVersion("2.1.99", "2.1.280"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "2.1.9"), "2.1.280");
    assert.equal(higherVersion("2.1.280", "3.0.0"), "3.0.0");
    assert.equal(higherVersion("2.1.280", "bad"), "2.1.280");
});

function rejection(required = "2.1.300"): Response {
    return new Response(
        JSON.stringify({
            error: {
                details: { error_code: "claude_code_version_too_old" },
                message: `version ${required} or newer is required`,
            },
        }),
        { status: 400 },
    );
}

const oauthInit = {
    method: "POST",
    headers: { authorization: "Bearer sk-ant-oat-test", "user-agent": "claude-cli/2.1.280" },
    body: JSON.stringify(payload),
};

void test("one version recovery learns the minimum for subsequent requests", async () => {
    const diagnostics = state();
    const bodies: string[] = [];
    const signal = new AbortController().signal;
    const next: ModelFetch = async (input, init) => {
        const request = requestFrom(input, init);
        assert.equal(request.signal.aborted, signal.aborted);
        bodies.push(await request.text());
        return bodies.length === 1 ? rejection() : new Response("stream-success");
    };
    const wrap = () =>
        oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
            version: "2.1.280",
            override: false,
        });
    const result = await wrap()("https://api.anthropic.com/v1/messages", { ...oauthInit, signal });
    assert.equal(await result.text(), "stream-success");
    assert.equal(bodies.length, 2);
    assert.match(bodies[0] ?? "", /cc_version=2\.1\.280\./);
    assert.match(bodies[1] ?? "", /cc_version=2\.1\.300\./);
    assert.equal(diagnostics.learnedFloor, "2.1.300");
    assert.equal(diagnostics.lastRetry, "recovered");
    assert.equal(diagnostics.versionError, null);
    await wrap()("https://api.anthropic.com/v1/messages", oauthInit);
    assert.equal(bodies.length, 3);
    assert.match(bodies[2] ?? "", /cc_version=2\.1\.300\./);
});

void test("a second version rejection is explained but never chased", async () => {
    const diagnostics = state();
    let calls = 0;
    const next: ModelFetch = () => {
        calls += 1;
        return Promise.resolve(rejection(calls === 1 ? "2.1.300" : "2.1.400"));
    };
    const wrapped = oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
        version: "2.1.280",
        override: false,
    });
    const response = await wrapped("https://api.anthropic.com/v1/messages", oauthInit);
    assert.equal(calls, 2);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /anthropic-subscription/);
    assert.equal(diagnostics.lastRetry, "failed");
    assert.equal(diagnostics.learnedFloor, "2.1.400");
});

void test("overrides, unrelated errors, unknown floors and existing blocks are never retried", async () => {
    for (const scenario of [
        "override",
        "other-error",
        "unknown-floor",
        "existing-block",
        "already-new-enough",
        "api-key",
        "aborted",
    ]) {
        const diagnostics = state();
        let calls = 0;
        const controller = new AbortController();
        const next: ModelFetch = () => {
            calls += 1;
            if (scenario === "aborted") {
                controller.abort();
            }
            if (scenario === "other-error") {
                return Promise.resolve(new Response("rate limited", { status: 429 }));
            }
            return Promise.resolve(
                rejection(
                    scenario === "unknown-floor"
                        ? "unknown"
                        : scenario === "already-new-enough"
                          ? "2.1.200"
                          : "2.1.300",
                ),
            );
        };
        const wrapped = oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
            version: "2.1.280",
            override: scenario === "override",
        });
        const existing = shapeRequest(payload, "2.1.280");
        const init = {
            ...oauthInit,
            signal: controller.signal,
            ...(scenario === "existing-block" ? { body: JSON.stringify(existing) } : {}),
            ...(scenario === "api-key" ? { headers: { "x-api-key": "test" } } : {}),
        };
        await wrapped("https://api.anthropic.com/v1/messages", init);
        assert.equal(calls, 1, scenario);
    }
});
