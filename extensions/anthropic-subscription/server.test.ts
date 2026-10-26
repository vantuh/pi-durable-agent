import assert from "node:assert/strict";
import { test } from "node:test";

import { shapeRequest } from "./server.ts";

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
