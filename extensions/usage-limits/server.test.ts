import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Host, ResolveModelAuth } from "../../server/sdk.ts";
import { createKeeper } from "./keeper.ts";
import { collect, readCodex, toMs, type Fetch } from "./readers.ts";
import { readerFor, type ProviderUsage } from "./refs.ts";
import { actions } from "./server.ts";
import { readSettings } from "./settings.ts";

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
        { codexHome: home },
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
    const apiKey = await collect(auth({ anthropic: "sk-ant-api-x" }), fetch, signal, {
        codexHome: home,
    });

    assert.deepEqual(apiKey, []);
    assert.deepEqual(seen, []);
});

void test("a failing provider becomes an error row without leaking the token", async () => {
    const fetch: Fetch = () => Promise.resolve(json({ secret: "sk-ant-oat-x" }, 500));
    const home = await mkdtemp(join(tmpdir(), "usage-"));
    const result = await collect(auth({ anthropic: "sk-ant-oat-x" }), fetch, signal, {
        codexHome: home,
    });

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

void test("a hidden provider is not asked", async () => {
    const seen: string[] = [];
    const fetch: Fetch = (input) => {
        seen.push(input instanceof Request ? input.url : input.toString());

        return Promise.resolve(json({ usage: { rolling: { percent: 1 } } }));
    };
    const home = await mkdtemp(join(tmpdir(), "usage-"));
    const result = await collect(
        auth({ anthropic: "sk-ant-oat-x", "opencode-go": "key" }),
        fetch,
        signal,
        { codexHome: home, hidden: ["anthropic", "codex"] },
    );

    assert.deepEqual(
        result.map((each) => each.id),
        ["opencode-go"],
    );
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /opencode/);
});

void test("settings: missing or broken file shows everything; actions validate and persist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "usage-"));

    assert.deepEqual(await readSettings(dir), { hidden: [] });

    await writeFile(join(dir, "usage-limits.json"), "{ not json");

    assert.deepEqual(await readSettings(dir), { hidden: [] });

    const host: Host = {
        name: "usage-limits",
        cwd: ".",
        dataDir: dir,
        log: () => undefined,
        onCommit: () => undefined,
        onDispose: () => undefined,
        shapeModelRequests: () => undefined,
        resolveModelAuth: auth({}),
        contextWindow: () => undefined,
        wrapModelFetch: () => undefined,
    };
    const { setShown, settings } = actions(host);
    const call = async (action: typeof setShown | undefined, args: unknown) =>
        await action?.({ args, session: null });

    await assert.rejects(call(setShown, { id: "nope", shown: false }), /args must be/);
    await assert.rejects(call(setShown, { id: "codex" }), /args must be/);

    // Quick toggles in a row must not lose one.
    await Promise.all([
        call(setShown, { id: "codex", shown: false }),
        call(setShown, { id: "anthropic", shown: false }),
    ]);

    assert.deepEqual(await call(settings, undefined), { hidden: ["codex", "anthropic"] });
    assert.deepEqual(await call(setShown, { id: "codex", shown: true }), {
        hidden: ["anthropic"],
    });
    assert.deepEqual(await readSettings(dir), { hidden: ["anthropic"] });
});

void test("a rate-limited provider keeps its last reading and is left alone for a while", async () => {
    let time = 0;
    const keep = createKeeper(() => time);
    const reading = (pct: number): ProviderUsage => ({
        id: "anthropic",
        name: "Anthropic",
        buckets: [{ label: "5 hours", session: true, pct, resetsAt: null }],
    });
    const asked: (readonly string[])[] = [];
    let answer: ProviderUsage = reading(10);
    const collectFn = (skip: readonly string[]) => {
        asked.push(skip);

        return Promise.resolve(skip.includes("anthropic") ? [] : [answer]);
    };

    assert.equal((await keep([], collectFn))[0]?.buckets[0]?.pct, 10);

    answer = { id: "anthropic", name: "Anthropic", buckets: [], error: "HTTP 429" };
    time = 1000;

    const limited = (await keep([], collectFn))[0];

    assert.equal(limited?.buckets[0]?.pct, 10);
    assert.match(limited?.error ?? "", /Rate limited.*last reading/);

    time = 60_000;

    const backedOff = (await keep([], collectFn))[0];

    assert.deepEqual(asked.at(-1), ["anthropic"]);
    assert.equal(backedOff?.buckets[0]?.pct, 10);

    time = 400_000;
    answer = reading(12);

    const recovered = (await keep([], collectFn))[0];

    assert.equal(recovered?.error, undefined);
    assert.equal(recovered?.buckets[0]?.pct, 12);
});
