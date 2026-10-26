import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { shapeModelRequests } from "../server/model-requests.ts";

void test("real ModelRuntime exposes resolved auth to wrappers for turns and compaction without network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-model-requests-"));
    try {
        const runtime = await ModelRuntime.create({
            refreshOnCreate: false,
            modelsPath: null,
            modelsStorePath: join(dir, "models.json"),
            credentials: {
                read: () => Promise.resolve({ type: "api_key", key: "sk-ant-oat-test-only" }),
                list: () => Promise.resolve([]),
                modify: (_provider, fn) => fn({ type: "api_key", key: "sk-ant-oat-test-only" }),
                delete: () => Promise.resolve(),
            },
        });
        const model = runtime
            .getModels("anthropic")
            .find((candidate) => candidate.api === "anthropic-messages");
        assert.ok(model);
        let payloadCalls = 0;
        let fetchCalls = 0;
        const wrapped = shapeModelRequests(
            runtime,
            () => [
                (payload) => {
                    assert.ok(typeof payload === "object" && payload !== null);
                    assert.equal(Reflect.get(payload, "callerMarker"), true);
                    payloadCalls += 1;
                    return { ...payload, extensionMarker: true };
                },
            ],
            () => [
                (next, requestModel) => async (input, init) => {
                    assert.equal(requestModel.provider, "anthropic");
                    const request = new Request(input, init);
                    assert.equal(
                        request.headers.get("authorization"),
                        "Bearer sk-ant-oat-test-only",
                    );
                    assert.match(request.headers.get("user-agent") ?? "", /^claude-cli\//);
                    return next(request);
                },
            ],
        );
        const options = {
            onPayload: (payload: unknown) => {
                assert.ok(typeof payload === "object" && payload !== null);
                return { ...payload, callerMarker: true };
            },
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const request = new Request(input, init);
                const body: unknown = await request.json();
                assert.ok(typeof body === "object" && body !== null);
                assert.equal(Reflect.get(body, "extensionMarker"), true);
                fetchCalls += 1;
                return Response.json(
                    {
                        type: "error",
                        error: {
                            type: "invalid_request_error",
                            message: "mocked, no upstream request",
                        },
                    },
                    { status: 400 },
                );
            },
        };
        const context = {
            messages: [{ role: "user", content: "hello", timestamp: 0 }],
        } satisfies Parameters<ModelRuntime["streamSimple"]>[1];
        await wrapped.streamSimple(model, context, options).result();
        await wrapped.completeSimple(model, context, options);
        assert.equal(payloadCalls, 2);
        assert.equal(fetchCalls, 2);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
