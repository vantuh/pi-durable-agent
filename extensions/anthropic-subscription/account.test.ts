import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelFetch, ResolveModelAuth } from "../../server/model-requests.ts";
import { account } from "./account-refs.ts";
import { lookupAccount } from "./account.ts";

const raw = {
    account: { email: "person@example.test", secret: "never-return" },
    organization: {
        name: "Personal organization",
        organization_type: "claude_max",
        subscription_status: "active",
        rate_limit_tier: "default_claude_max_20x",
        seat_tier: "premium",
        has_extra_usage_enabled: false,
    },
    other_secret: "never-return",
};
const oauth: ResolveModelAuth = () => Promise.resolve({ apiKey: "sk-ant-oat-test-secret" });

void test("profile lookup is fixed-origin, timed, on demand, and strips identity by default", async () => {
    let calls = 0;
    const fetch: ModelFetch = (input, init) => {
        calls += 1;
        assert.equal(input, "https://api.anthropic.com/api/oauth/profile");
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer sk-ant-oat-test-secret");
        assert.equal(headers.get("anthropic-beta"), "oauth-2025-04-20");
        return Promise.resolve(Response.json(raw));
    };
    assert.equal(calls, 0);
    const result = account.parse(await lookupAccount(oauth, false, fetch));
    assert.equal(calls, 1);
    assert.equal(result.kind, "profile");
    if (result.kind !== "profile") {
        throw new Error("Expected profile");
    }
    assert.equal(result.profile.organizationType, "claude_max");
    assert.equal(result.profile.extraUsageEnabled, false);
    assert.equal(result.profile.email, null);
    assert.equal(result.profile.organizationName, null);
    assert.equal(JSON.stringify(result).includes("person@example.test"), false);
    assert.equal(JSON.stringify(result).includes("never-return"), false);
    assert.equal(JSON.stringify(result).includes("sk-ant-oat"), false);
    const identified = await lookupAccount(oauth, true, fetch);
    assert.equal(calls, 2);
    assert.equal(
        identified.kind === "profile" ? identified.profile.email : null,
        "person@example.test",
    );
});

void test("API keys and missing credentials cause no profile HTTP request", async () => {
    const noFetch: ModelFetch = () => {
        throw new Error("must not fetch");
    };
    for (const resolve of [
        () => Promise.resolve(undefined),
        () => Promise.resolve({ apiKey: "sk-ant-api-test" }),
    ]) {
        assert.deepEqual(await lookupAccount(resolve, false, noFetch), { kind: "not-oauth" });
    }
});

void test("bearer auth works and unknown profile fields remain unknown", async () => {
    const result = await lookupAccount(
        () => Promise.resolve({ headers: { Authorization: "Bearer sk-ant-oat-test" } }),
        false,
        () =>
            Promise.resolve(
                Response.json({
                    organization: { organization_type: 123, has_extra_usage_enabled: "false" },
                }),
            ),
    );
    assert.equal(result.kind === "profile" ? result.profile.organizationType : undefined, null);
    assert.equal(result.kind === "profile" ? result.profile.extraUsageEnabled : undefined, null);
});

void test("profile failures and auth errors never expose raw response bodies or secrets", async () => {
    for (const fetch of [
        () => Promise.resolve(new Response("private-email-and-token", { status: 401 })),
        () => Promise.resolve(new Response("bad JSON")),
        () => Promise.resolve(Response.json({ error: "private" })),
        () => Promise.reject(new Error("secret sk-ant-oat-test")),
    ]) {
        const result = await lookupAccount(oauth, false, fetch);
        assert.equal(result.kind, "unavailable");
        assert.equal(JSON.stringify(result).includes("private"), false);
        assert.equal(JSON.stringify(result).includes("sk-ant-oat"), false);
    }
    const result = await lookupAccount(() => Promise.reject(new Error("secret-token")), false);
    assert.deepEqual(result, { kind: "unavailable", reason: "Account lookup failed" });
    const aborted = new AbortController();
    aborted.abort();
    const timedOut = await lookupAccount(
        oauth,
        false,
        () => {
            throw new Error("must not fetch");
        },
        aborted.signal,
    );
    assert.equal(
        timedOut.kind === "unavailable" ? timedOut.reason : "",
        "Account lookup timed out or was cancelled",
    );
});
