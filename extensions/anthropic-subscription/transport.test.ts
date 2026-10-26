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
