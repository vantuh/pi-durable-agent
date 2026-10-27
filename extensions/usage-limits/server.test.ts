import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ResolveModelAuth } from "../../server/model-requests.ts";
import { collect, readCodex, toMs, type Fetch } from "./readers.ts";
import { readerFor } from "./refs.ts";

const signal = new AbortController().signal;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

const auth =
    (tokens: Record<string, string>): ResolveModelAuth =>
    // oxlint-disable-next-line typescript/require-await -- the real one is async
    async (provider) => {
        const token = tokens[provider];

        return token === undefined ? undefined : { apiKey: token, headers: {} };
    };

void test("readerFor maps Pi's provider ids", () => {
    assert.equal(readerFor("anthropic/claude-opus"), "anthropic");
    assert.equal(readerFor("openai/gpt-5"), "codex");
    assert.equal(readerFor("openai-codex/gpt-5"), "codex");
    assert.equal(readerFor("opencode-go/glm"), "opencode-go");
    assert.equal(readerFor("cursor/x"), null);
    assert.equal(readerFor(null), null);
});

void test("toMs reads ISO strings, epoch seconds and milliseconds", () => {
    assert.equal(toMs("2026-01-01T00:00:00.000Z"), Date.UTC(2026, 0, 1));
    assert.equal(toMs(1_700_000_000), 1_700_000_000_000);
    assert.equal(toMs(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(toMs(undefined), null);
    assert.equal(toMs("nonsense"), null);
});

void test("collect reads Anthropic and OpenCode Go, marks the session window, skips API keys", async () => {
    const seen: string[] = [];
    const fetch: Fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();

        seen.push(url);
        assert.equal(init?.redirect, "error");

        return Promise.resolve(
            url.includes("anthropic")
                ? json({
                      five_hour: { utilization: 42, resets_at: "2026-01-01T05:00:00Z" },
                      seven_day: { utilization: 10, resets_at: null },
                      seven_day_opus: null,
                  })
                : json({
                      usage: {
                          rolling: { percent: 3, resetsAt: "2026-01-01T05:00:00Z" },
                          weekly: { percent: 4 },
                      },
                  }),
        );
    };
    const home = await mkdtemp(join(tmpdir(), "usage-"));
    const result = await collect(
        auth({ anthropic: "sk-ant-oat-x", "opencode-go": "key" }),
        fetch,
        signal,
        home,
    );

    assert.deepEqual(
        result.map((each) => [each.id, each.buckets.map((b) => [b.label, b.session, b.pct])]),
        [
            [
                "anthropic",
                [
                    ["5 hours", true, 42],
                    ["7 days", false, 10],
                ],
            ],
            [
                "opencode-go",
                [
                    ["5 hours", true, 3],
                    ["7 days", false, 4],
                ],
            ],
        ],
    );

    seen.length = 0;
    const apiKey = await collect(auth({ anthropic: "sk-ant-api-x" }), fetch, signal, home);

    assert.deepEqual(apiKey, []);
    assert.deepEqual(seen, []);
});

void test("a failing provider becomes an error row without leaking the token", async () => {
    const fetch: Fetch = () => Promise.resolve(json({ secret: "sk-ant-oat-x" }, 500));
    const home = await mkdtemp(join(tmpdir(), "usage-"));
    const result = await collect(auth({ anthropic: "sk-ant-oat-x" }), fetch, signal, home);

    assert.deepEqual(result, [
        { id: "anthropic", name: "Anthropic", buckets: [], error: "HTTP 500" },
    ]);
});

void test("Codex uses the Codex CLI sign-in and is absent without one", async () => {
    const home = await mkdtemp(join(tmpdir(), "usage-"));
    let headers: HeadersInit | undefined;
    const fetch: Fetch = (_input, init) => {
        headers = init?.headers;

        return Promise.resolve(
            json({
                plan_type: "plus",
                rate_limit: {
                    primary_window: { used_percent: 20, reset_at: 1_800_000_000 },
                    secondary_window: { used_percent: 5, reset_at: 1_800_100_000 },
                },
            }),
        );
    };

    assert.equal(await readCodex(fetch, signal, home), undefined);

    await writeFile(
        join(home, "auth.json"),
        JSON.stringify({ tokens: { access_token: "a", account_id: "b" } }),
    );

    const usage = await readCodex(fetch, signal, home);

    assert.equal(usage?.name, "OpenAI Codex (plus)");
    assert.deepEqual(
        usage?.buckets.map((b) => [b.label, b.session, b.pct]),
        [
            ["5 hours", true, 20],
            ["7 days", false, 5],
        ],
    );
    assert.deepEqual(headers, { authorization: "Bearer a", "chatgpt-account-id": "b" });
});
