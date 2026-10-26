import assert from "node:assert/strict";
import { test } from "node:test";

import type { Host } from "../../server/extensions.ts";
import type { FetchWrapper, ModelFetch } from "../../server/model-requests.ts";
import { diagnostics } from "./refs.ts";
import subscription, { actions, shapeRequest } from "./server.ts";

const identity = {
    type: "text",
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
};

void test("prepends billing identity without changing existing blocks or messages", () => {
    const payload = {
        system: [
            identity,
            { type: "text", text: "Project rules", cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: "hello" }],
    };
    const result = shapeRequest(payload, "2.1.280");
    assert.ok(typeof result === "object" && result !== null);
    const system: unknown = Reflect.get(result, "system");
    assert.ok(Array.isArray(system));
    assert.deepEqual(system.slice(1), payload.system);
    assert.match(
        JSON.stringify(system[0]),
        /cc_version=2\.1\.280\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=2cf24;/,
    );
    assert.equal(Reflect.get(result, "messages"), payload.messages);
    assert.equal(payload.system.length, 2);
    assert.equal(shapeRequest(result, "2.1.280"), undefined);
});

void test("API-key requests, malformed payloads and missing first-user text are untouched", () => {
    for (const payload of [
        null,
        {},
        { system: [{ text: "Normal API prompt" }] },
        { system: [identity], messages: [] },
        {
            system: [identity],
            messages: [
                { role: "user", content: [] },
                { role: "user", content: "later" },
            ],
        },
    ]) {
        assert.equal(shapeRequest(payload, "2.1.280"), undefined);
    }
});

void test("text content blocks seed the same billing identity as string content", () => {
    const request = (content: unknown) => ({
        system: [identity],
        messages: [{ role: "user", content }],
    });
    assert.deepEqual(
        Reflect.get(Object(shapeRequest(request("hello"), "2.1.280")), "system"),
        Reflect.get(
            Object(
                shapeRequest(
                    request([{ type: "image" }, { type: "text", text: "hello" }]),
                    "2.1.280",
                ),
            ),
            "system",
        ),
    );
});

function setup() {
    const wrappers: FetchWrapper[] = [];
    const disposers: (() => void | Promise<void>)[] = [];
    const host: Host = {
        name: "anthropic-subscription",
        cwd: ".",
        dataDir: ".",
        log: () => undefined,
        onCommit: () => undefined,
        onDispose: (dispose) => {
            disposers.push(dispose);
        },
        shapeModelRequests: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        wrapModelFetch: (wrap) => {
            wrappers.push(wrap);
        },
    };
    subscription(host);
    const read = () =>
        diagnostics.parse(actions(host)["diagnostics"]?.({ args: undefined, session: null }));
    const shape = async (payload: unknown, provider = "anthropic", oauth = true) => {
        let sent: unknown;
        const next: ModelFetch = async (input, init) => {
            sent = await new Request(input, init).json();
            return new Response("ok");
        };
        const fetch = wrappers[0]?.(next, { provider });
        await fetch?.("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: oauth
                ? { authorization: "Bearer sk-ant-oat-test" }
                : { "x-api-key": "sk-ant-api-test" },
            body: JSON.stringify(payload),
        });
        return sent;
    };
    return { host, read, shape, disposers };
}

void test("diagnostics record only outcome, provider and time, never request content", async () => {
    const { read, shape } = setup();
    assert.equal(read().last, null);
    const payload = { system: [identity], messages: [{ role: "user", content: "private text" }] };
    const shaped = await shape(payload);
    assert.equal(read().last?.outcome, "applied");
    assert.equal(read().last?.provider, "anthropic");
    assert.ok((read().last?.at ?? 0) > 0);
    assert.equal(JSON.stringify(read()).includes("private text"), false);
    await shape(shaped);
    assert.equal(read().last?.outcome, "already-shaped");
    const beforeOtherProvider = structuredClone(read());
    await shape(payload, "openai");
    assert.deepEqual(read(), beforeOtherProvider);
    await shape({ system: [{ type: "text", text: "API key prompt" }] }, "anthropic", false);
    assert.equal(read().last?.outcome, "not-oauth");
    await shape({ system: [identity], messages: [] });
    assert.equal(read().last?.outcome, "no-user-text");
});

void test("version source, host isolation and reload reset", async () => {
    const key = "PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION";
    const previous = process.env[key];
    try {
        delete process.env[key];
        const first = setup();
        assert.equal(first.read().version, "2.1.280");
        assert.equal(first.read().source, "default");
        await first.shape({}, "openai");
        assert.equal(setup().read().last, null);
        for (const dispose of first.disposers) {
            await dispose();
        }
        assert.equal(
            actions(first.host)["diagnostics"]?.({ args: undefined, session: null }),
            undefined,
        );
        process.env[key] = " 2.1.300 ";
        const override = setup();
        assert.equal(override.read().version, "2.1.300");
        assert.equal(override.read().source, "environment");
        assert.equal(override.read().last, null);
        process.env[key] = "invalid";
        assert.throws(setup, /must be X.Y.Z/);
    } finally {
        if (previous === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = previous;
        }
    }
});

void test("diagnostics contract rejects malformed data", () => {
    for (const value of [
        null,
        {},
        {
            version: "2.1.280",
            source: "default",
            last: { outcome: "made-up", provider: "anthropic", at: 1 },
        },
        { version: "2.1.280", source: "default", last: null },
    ]) {
        if (value?.last === null) {
            assert.equal(diagnostics.parse(value).last, null);
        } else {
            assert.throws(() => diagnostics.parse(value));
        }
    }
});

void test("authorization, not prompt identity, gates OAuth shaping", async () => {
    const { shape } = setup();
    const payload = {
        system: [{ type: "text", text: "Custom identity" }],
        messages: [{ role: "user", content: "hello" }],
    };
    assert.notDeepEqual(await shape(payload), payload);
    assert.deepEqual(await shape(payload, "anthropic", false), payload);
    assert.deepEqual(await shape(payload, "openai"), payload);
    const spoof = { ...payload, system: [identity] };
    assert.deepEqual(await shape(spoof, "anthropic", false), spoof);
});

void test("account action validates identity opt-in and defaults to no OAuth without auth capability", async () => {
    const { host } = setup();
    const action = actions(host)["account"];
    assert.ok(action);
    for (const args of [null, "yes", { includeIdentity: "true" }]) {
        assert.throws(() => action({ args, session: null }), /includeIdentity must be a boolean/);
    }
    assert.deepEqual(await action({ args: undefined, session: null }), { kind: "not-oauth" });
});
