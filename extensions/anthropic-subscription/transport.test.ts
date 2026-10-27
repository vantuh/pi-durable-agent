import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelFetch } from "../../server/sdk.ts";
import { type Diagnostics } from "./refs.ts";
import { shapeRequest } from "./server.ts";
import { oauthTransport, requestFrom } from "./transport.ts";
import { cliVersion, higherVersion } from "./version.ts";

const payload = {
    system: [{ type: "text", text: "Project rules" }],
    messages: [{ role: "user", content: "hello" }],
};

function state(): Diagnostics {
    return {
        version: "2.1.280",
        sentVersion: null,
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
        ["wrapper/1.0 claude-cli/2.1.350 (external, cli)", "2.1.350"],
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
    assert.equal(diagnostics.sentVersion, "2.1.300");
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

void test("other providers and non-message endpoints leave Anthropic diagnostics untouched", async () => {
    const diagnostics = state();
    const next: ModelFetch = () => Promise.resolve(new Response("ok"));
    const configured = { version: "2.1.280", override: false };
    const foreign = oauthTransport(
        next,
        { provider: "openai" },
        diagnostics,
        shapeRequest,
        configured,
    );
    await foreign("custom-provider-input");
    assert.equal(diagnostics.last, null);
    await oauthTransport(
        next,
        { provider: "anthropic" },
        diagnostics,
        shapeRequest,
        configured,
    )("https://api.anthropic.com/v1/messages", oauthInit);
    const previous = structuredClone(diagnostics);
    await foreign("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });
    await oauthTransport(
        next,
        { provider: "anthropic" },
        diagnostics,
        shapeRequest,
        configured,
    )("https://api.anthropic.com/api/oauth/profile");
    assert.deepEqual(diagnostics, previous);
});

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error("Promise executor did not run");
    };
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

void test("older recovery and failure cannot overwrite a newer request snapshot, but may teach a floor", async () => {
    for (const fails of [false, true]) {
        const diagnostics = state();
        const started = deferred<void>();
        const response = deferred<Response>();
        let calls = 0;
        const oldFetch: ModelFetch = () => {
            calls += 1;
            if (calls === 1) {
                started.resolve();
                return response.promise;
            }
            return Promise.resolve(fails ? rejection("2.1.400") : new Response("ok"));
        };
        const configured = { version: "2.1.280", override: false };
        const older = oauthTransport(
            oldFetch,
            { provider: "anthropic" },
            diagnostics,
            shapeRequest,
            configured,
        )("https://api.anthropic.com/v1/messages", oauthInit);
        await started.promise;
        await oauthTransport(
            () => Promise.resolve(new Response("newer")),
            { provider: "anthropic" },
            diagnostics,
            shapeRequest,
            configured,
        )("https://api.anthropic.com/v1/messages", {
            ...oauthInit,
            headers: { ...oauthInit.headers, "user-agent": "claude-cli/2.1.500" },
        });
        const expected = structuredClone(diagnostics);
        response.resolve(rejection());
        const oldResponse = await older;
        assert.equal(oldResponse.status, fails ? 400 : 200);
        expected.learnedFloor = fails ? "2.1.400" : "2.1.300";
        assert.deepEqual(diagnostics, expected);
        assert.equal(diagnostics.version, "2.1.500");
        assert.equal(diagnostics.sentVersion, "2.1.500");
        assert.equal(diagnostics.lastRetry, "none");
        assert.equal(diagnostics.versionError, null);
    }
});

void test("existing billing block reports actual version separately from selected version without rewriting", async () => {
    for (const existingVersion of ["2.1.100", "2.1.500", "unparseable"]) {
        const diagnostics = state();
        const existing =
            existingVersion === "unparseable"
                ? {
                      ...payload,
                      system: [{ type: "text", text: "x-anthropic-billing-header: custom value" }],
                  }
                : shapeRequest(payload, existingVersion);
        const body = JSON.stringify(existing);
        let calls = 0;
        const next: ModelFetch = async (input, init) => {
            calls += 1;
            assert.equal(await requestFrom(input, init).text(), body);
            return new Response("ok");
        };
        await oauthTransport(next, { provider: "anthropic" }, diagnostics, shapeRequest, {
            version: "2.1.280",
            override: false,
        })("https://api.anthropic.com/v1/messages", {
            ...oauthInit,
            body,
            headers: { ...oauthInit.headers, "user-agent": "claude-cli/2.1.400" },
        });
        assert.equal(calls, 1);
        assert.equal(diagnostics.version, "2.1.400");
        assert.equal(
            diagnostics.sentVersion,
            existingVersion === "unparseable" ? null : existingVersion,
        );
        assert.equal(diagnostics.last?.outcome, "already-shaped");
    }
});

void test("API-key request clears OAuth-only snapshot fields instead of retaining prior metadata", async () => {
    const diagnostics = state();
    const fetch = oauthTransport(
        () => Promise.resolve(new Response("ok")),
        { provider: "anthropic" },
        diagnostics,
        shapeRequest,
        { version: "2.1.280", override: false },
    );
    await fetch("https://api.anthropic.com/v1/messages", oauthInit);
    assert.equal(diagnostics.sentVersion, "2.1.280");
    await fetch("https://api.anthropic.com/v1/messages", {
        ...oauthInit,
        headers: { "x-api-key": "test" },
    });
    assert.equal(diagnostics.last?.outcome, "not-oauth");
    assert.equal(diagnostics.sentVersion, null);
    assert.equal(diagnostics.transportVersion, null);
    assert.equal(diagnostics.versionError, null);
});

void test("User-Agent token parsing matches donor boundaries including prefixes", () => {
    for (const ua of [
        "claude-cli/2.1.400",
        "other-client/1.0 claude-cli/2.1.400",
        "other-client/1.0 claude-cli/2.1.400 (external, cli)",
    ]) {
        assert.equal(
            cliVersion(new Request("https://example.test", { headers: { "user-agent": ua } })),
            "2.1.400",
        );
    }
    for (const ua of [
        "notclaude-cli/2.1.400",
        "claude-cli/2.1.400.1",
        "claude-cli/2.1.400-beta",
        "claude-cli/2.1",
        "unknown",
    ]) {
        assert.equal(
            cliVersion(new Request("https://example.test", { headers: { "user-agent": ua } })),
            undefined,
        );
    }
});

void test("version rejection advice uses the actual existing block, not the selected version", async () => {
    for (const version of ["2.1.100", "2.1.500"]) {
        const diagnostics = state();
        let calls = 0;
        const next: ModelFetch = () => {
            calls += 1;
            return Promise.resolve(rejection());
        };
        const response = await oauthTransport(
            next,
            { provider: "anthropic" },
            diagnostics,
            shapeRequest,
            { version: "2.1.280", override: false },
        )("https://api.anthropic.com/v1/messages", {
            ...oauthInit,
            body: JSON.stringify(shapeRequest(payload, version)),
            headers: { ...oauthInit.headers, "user-agent": "claude-cli/2.1.400" },
        });
        const message = await response.text();
        assert.equal(calls, 1);
        if (version === "2.1.500") {
            assert.match(message, /already reports 2\.1\.500/);
        } else {
            assert.doesNotMatch(message, /already reports/);
        }
    }
});
