import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import type { ResolveModelAuth } from "../../server/sdk.ts";
import { billingBlock, readMessages, searchAnthropic } from "./anthropic.ts";
import { type Provider, formatAnswer, runChain } from "./chain.ts";
import { readResponses, searchChatgpt } from "./chatgpt.ts";
import { MAX_OUTPUT, readKiro, searchKiro } from "./kiro.ts";
import type { Found } from "./wire.ts";

const ask = { query: "latest Node.js LTS", urls: [] };
const fixture = (name: string) =>
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const OPENAI_TOKEN = "eyJ.fake-chatgpt-token.sig";
const CLAUDE_TOKEN = "sk-ant-oat01-fake-claude-token";

const authWith =
    (tokens: Record<string, string>): ResolveModelAuth =>
    (provider) =>
        Promise.resolve(tokens[provider] === undefined ? undefined : { apiKey: tokens[provider] });

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

/** A fetch that records what it was sent and answers with `respond`. */
function stubFetch(respond: () => Response): { fetch: typeof fetch; calls: Call[] } {
    const calls: Call[] = [];
    const stub: typeof fetch = (input, init) => {
        const parsed: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");

        calls.push({
            url: input instanceof Request ? input.url : input.toString(),
            headers: new Headers(init?.headers),
            body:
                typeof parsed === "object" && parsed !== null
                    ? Object.fromEntries(Object.entries(parsed))
                    : {},
        });

        return Promise.resolve(respond());
    };

    return { fetch: stub, calls };
}

/** A stream as the parsers read it: one `data:` line per event. */
const streamOf = (...events: unknown[]) =>
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

const signal = () => new AbortController().signal;
const sse = (text: string) =>
    new Response(text, { headers: { "content-type": "text/event-stream" } });

void describe("web-search chatgpt", () => {
    void it("reads the answer and the cited sources, without OpenAI's utm tag", async () => {
        const { fetch, calls } = stubFetch(() => sse(fixture("chatgpt.sse")));
        const found = await searchChatgpt(authWith({ openai: OPENAI_TOKEN }), "q", signal(), fetch);

        assert.match(found.answer, /^The latest Node\.js LTS is \*\*v26\.13\.0\*\*/);
        assert.doesNotMatch(found.answer, /utm_source/);
        assert.deepEqual(found.sources, [
            {
                url: "https://nodejs.org/en/download?trk=public_profile__posts-text",
                title: "Node.js — Download Node.js®",
            },
        ]);
        assert.equal(found.model, "gpt-6-luna");

        const [call] = calls;

        assert.equal(call?.url, "https://api.openai.com/v1/responses");
        assert.equal(call?.headers.get("authorization"), `Bearer ${OPENAI_TOKEN}`);
        assert.deepEqual(call?.body["tools"], [{ type: "web_search" }]);
        assert.equal(call?.body["stream"], true);
        assert.equal(call?.body["store"], false);
    });

    const message = (phase: string | undefined, text: string, url?: string) => ({
        type: "response.output_item.done",
        item: {
            type: "message",
            ...(phase === undefined ? {} : { phase }),
            content: [
                {
                    type: "output_text",
                    text,
                    annotations:
                        url === undefined ? [] : [{ type: "url_citation", url, title: "T" }],
                },
            ],
        },
    });

    void it("drops commentary messages and keeps their citations out of the sources", () => {
        const found = readResponses(
            streamOf(
                message("commentary", "I'll look that up.", "https://example.com/narration"),
                message("final_answer", "Node 26 is LTS.", "https://nodejs.org/"),
            ),
        );

        assert.equal(found.answer, "Node 26 is LTS.");
        assert.deepEqual(
            found.sources.map((source) => source.url),
            ["https://nodejs.org/"],
        );
    });

    void it("joins several answer messages, and messages without a phase, with a blank line", () => {
        const found = readResponses(
            streamOf(message("final_answer", "First."), message(undefined, "Second.")),
        );

        assert.equal(found.answer, "First.\n\nSecond.");
    });

    void it("refuses an API key and a missing login without calling out", async () => {
        const { fetch, calls } = stubFetch(() => sse(""));

        await assert.rejects(
            searchChatgpt(authWith({ openai: "sk-proj-abc" }), "q", signal(), fetch),
            {
                message: "not signed in with ChatGPT",
            },
        );
        await assert.rejects(searchChatgpt(authWith({}), "q", signal(), fetch), {
            message: "not signed in with ChatGPT",
        });
        assert.equal(calls.length, 0);
    });

    void it("reports status and a trimmed body on an HTTP error, never the token", async () => {
        const { fetch } = stubFetch(
            () => new Response(`{"error":"${"x".repeat(500)}"}`, { status: 401 }),
        );
        const error = await searchChatgpt(
            authWith({ openai: OPENAI_TOKEN }),
            "q",
            signal(),
            fetch,
        ).catch((failure: unknown) => failure);

        assert.ok(error instanceof Error);
        assert.match(error.message, /^HTTP 401: \{"error":"x+/);
        assert.ok(error.message.length < 220);
        assert.ok(!error.message.includes(OPENAI_TOKEN));
    });

    void it("fails on a stream that ends in an error although the HTTP status was 200", async () => {
        const failed = `event: response.failed\ndata: ${JSON.stringify({
            type: "response.failed",
            response: { error: { message: "usage limit reached" } },
        })}\n\n`;
        const { fetch } = stubFetch(() => sse(failed));

        await assert.rejects(
            searchChatgpt(authWith({ openai: OPENAI_TOKEN }), "q", signal(), fetch),
            {
                message: "stream error: usage limit reached",
            },
        );
    });
});

void describe("web-search anthropic", () => {
    void it("reads the answer and prefers the cited sources over the search results", async () => {
        const { fetch } = stubFetch(() => sse(fixture("anthropic.sse")));
        const found = await searchAnthropic(
            authWith({ anthropic: CLAUDE_TOKEN }),
            "q",
            signal(),
            fetch,
        );

        assert.match(found.answer, /^The latest Node\.js LTS release appears to be \*\*24\.22\.1/);
        assert.deepEqual(
            found.sources.map((source) => source.url),
            [
                "https://github.com/nodejs/node/releases",
                "https://nodejs.org/en/blog/release/v22.23.4",
                "https://nodejs.org/en/download",
            ],
        );
        assert.equal(found.sources[0]?.title, "Releases · nodejs/node · GitHub");
    });

    void it("sends the Claude Code identity, the billing block and a direct-only search tool", async () => {
        const { fetch, calls } = stubFetch(() => sse(fixture("anthropic.sse")));

        await searchAnthropic(
            authWith({ anthropic: CLAUDE_TOKEN }),
            "latest Node.js LTS",
            signal(),
            fetch,
        );

        const [call] = calls;
        const system: unknown = call?.body["system"];

        assert.equal(call?.url, "https://api.anthropic.com/v1/messages");
        assert.equal(call?.headers.get("authorization"), `Bearer ${CLAUDE_TOKEN}`);
        assert.match(call?.headers.get("anthropic-beta") ?? "", /oauth-2025-04-20/);
        assert.match(call?.headers.get("user-agent") ?? "", /^claude-cli\/\d+\.\d+\.\d+$/);
        assert.ok(Array.isArray(system));
        assert.match(
            JSON.stringify(system[0]),
            /^\{"type":"text","text":"x-anthropic-billing-header: cc_version=\d+\.\d+\.\d+\.[0-9a-f]{3}; cc_entrypoint=sdk-cli; cch=[0-9a-f]{5};"\}$/,
        );
        assert.match(JSON.stringify(system[1]), /You are Claude Code/);
        assert.deepEqual(call?.body["tools"], [
            {
                type: "web_search_20260209",
                name: "web_search",
                max_uses: 5,
                allowed_callers: ["direct"],
            },
        ]);
    });

    const block = (index: number, type: string, extra: object = {}) => ({
        type: "content_block_start",
        index,
        content_block: { type, ...extra },
    });
    const textDelta = (index: number, text: string) => ({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
    });
    const stopped = (stop_reason: string) => ({ type: "message_delta", delta: { stop_reason } });

    void it("drops the text before the last search and joins the blocks cut at citations without a gap", () => {
        const found = readMessages(
            streamOf(
                block(0, "text"),
                textDelta(0, "I'll search for it."),
                block(1, "server_tool_use"),
                block(2, "web_search_tool_result", { content: [] }),
                block(3, "text"),
                textDelta(3, "Let me check once more."),
                block(4, "server_tool_use"),
                block(5, "web_search_tool_result", { content: [] }),
                block(6, "text"),
                textDelta(6, "Node 26 is "),
                block(7, "text"),
                textDelta(7, "LTS."),
                stopped("end_turn"),
            ),
        );

        assert.equal(found.answer, "Node 26 is LTS.");
    });

    void it("fails on an answer that stopped early, so the next provider gets the question", () => {
        for (const reason of ["pause_turn", "max_tokens"]) {
            assert.throws(
                () =>
                    readMessages(
                        streamOf(block(0, "text"), textDelta(0, "Partial"), stopped(reason)),
                    ),
                { message: `the answer stopped early (${reason})` },
            );
        }
    });

    void it("builds the billing block exactly as anthropic-subscription does", () => {
        // Expected value computed once by that extension's shapeRequest for this prompt and version.
        assert.deepEqual(
            billingBlock("Search the web and answer this: latest Node.js LTS", "2.1.280"),
            {
                type: "text",
                text: "x-anthropic-billing-header: cc_version=2.1.280.5b2; cc_entrypoint=sdk-cli; cch=4260c;",
            },
        );
    });

    void it("needs a subscription token, not an API key", async () => {
        const { fetch, calls } = stubFetch(() => sse(""));

        await assert.rejects(
            searchAnthropic(authWith({ anthropic: "sk-ant-api03-abc" }), "q", signal(), fetch),
            { message: "not signed in with a Claude subscription" },
        );
        assert.equal(calls.length, 0);
    });

    void it("fails on an error event in a 200 stream", async () => {
        const overloaded = `event: error\ndata: ${JSON.stringify({
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
        })}\n\n`;
        const { fetch } = stubFetch(() => sse(overloaded));

        await assert.rejects(
            searchAnthropic(authWith({ anthropic: CLAUDE_TOKEN }), "q", signal(), fetch),
            { message: "stream error: Overloaded" },
        );
    });
});

void describe("web-search kiro", () => {
    const line = (value: unknown) => JSON.stringify(value);
    const chunk = (text: string) =>
        line({
            type: "sessionUpdate",
            data: {
                update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
            },
        });
    const toolCall = line({
        type: "sessionUpdate",
        data: { update: { sessionUpdate: "tool_call" } },
    });

    void it("keeps the text after the last tool call and splits off the sources list", () => {
        const found = readKiro(
            [
                chunk("I'll search for it."),
                toolCall,
                chunk("Node 26 is LTS.\n\nSources:\nhttps://nodejs.org/en/"),
                chunk("blog/release\nhttps://nodejs.org/en/about.\n"),
                line({ type: "runFinished", data: { status: "success" } }),
            ].join("\n"),
        );

        assert.equal(found.answer, "Node 26 is LTS.");
        assert.deepEqual(
            found.sources.map((source) => source.url),
            ["https://nodejs.org/en/blog/release", "https://nodejs.org/en/about"],
        );
    });

    void it("fails when the run did not succeed", () => {
        assert.throws(() => readKiro(line({ type: "runFinished", data: { status: "error" } })), {
            message: "kiro-cli run ended: error",
        });
    });
});

void describe("web-search kiro process", () => {
    // A stand-in `kiro-cli` on PATH. Its last argument (the prompt) picks what it does; "hang" ignores SIGTERM like a stuck run.
    const SCRIPT = `#!${process.execPath}
const fs = require("fs");
const path = require("path");
const mode = process.argv.at(-1);
const seen = { cwd: process.cwd(), pid: process.pid };
if (mode === "hang") {
    // Like the real thing: the wrapper does the work in a child that shares its stdout.
    const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
    seen.child = child.pid;
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
}
fs.writeFileSync(path.join(__dirname, "seen.json"), JSON.stringify(seen));
if (mode === "flood") process.stdout.write("x".repeat(${MAX_OUTPUT + 1}));
else if (mode !== "hang") {
    const chunk = (text) => ({ type: "sessionUpdate", data: { update: { sessionUpdate: "agent_message_chunk", content: { text } } } });
    console.log(JSON.stringify(chunk("It works.\\n\\nSources:\\nhttps://example.com/a")));
}
`;

    async function withKiro<T>(
        script: string | undefined,
        body: (bin: string) => Promise<T>,
    ): Promise<T> {
        const bin = await mkdtemp(join(tmpdir(), "web-search-bin-"));
        const path = process.env["PATH"];

        if (script !== undefined) {
            await writeFile(join(bin, "kiro-cli"), script);
            await chmod(join(bin, "kiro-cli"), 0o755);
        } else {
            await mkdir(join(bin, "empty"));
        }

        process.env["PATH"] = bin;

        try {
            return await body(bin);
        } finally {
            process.env["PATH"] = path;
            await rm(bin, { recursive: true, force: true });
        }
    }

    const seen = (bin: string): { cwd: string; pid: number; child?: number } =>
        JSON.parse(readFileSync(join(bin, "seen.json"), "utf8"));

    void it("runs in a folder of its own and removes it afterwards", async () => {
        await withKiro(SCRIPT, async (bin) => {
            const found = await searchKiro("ok", signal());

            assert.equal(found.answer, "It works.");
            assert.deepEqual(found.sources, [
                { url: "https://example.com/a", title: "example.com/a" },
            ]);
            assert.notEqual(seen(bin).cwd, process.cwd());
            assert.equal(existsSync(seen(bin).cwd), false);
        });
    });

    void it("says so when kiro-cli is not installed", async () => {
        await withKiro(undefined, async () => {
            await assert.rejects(searchKiro("ok", signal()), {
                message: "kiro-cli is not installed",
            });
        });
    });

    const running = (pid: number) => {
        try {
            process.kill(pid, 0);

            return true;
        } catch {
            return false;
        }
    };

    void it("kills the process and the child it started on abort, and removes its folder", async () => {
        await withKiro(SCRIPT, async (bin) => {
            const controller = new AbortController();
            const pending = searchKiro("hang", controller.signal);
            const guard = AbortSignal.timeout(5000);

            while (!existsSync(join(bin, "seen.json")) && !guard.aborted) {
                await sleep(20);
            }

            const { pid, child, cwd } = seen(bin);

            assert.ok(child !== undefined);

            try {
                const aborted = Date.now();

                controller.abort();
                await assert.rejects(pending, { name: "AbortError" });
                // The child holds the pipe: while it lives, the call cannot settle.
                assert.ok(Date.now() - aborted < 2000);

                const deadline = Date.now() + 5000;

                while ((running(pid) || running(child)) && Date.now() < deadline) {
                    await sleep(20);
                }

                assert.equal(running(pid), false);
                assert.equal(running(child), false);
                assert.equal(existsSync(cwd), false);
            } finally {
                for (const left of [pid, child]) {
                    try {
                        process.kill(left, "SIGKILL");
                    } catch {
                        // Already gone, which is the point.
                    }
                }
            }
        });
    });

    void it("refuses more output than it will hold", async () => {
        await withKiro(SCRIPT, async () => {
            await assert.rejects(searchKiro("flood", signal()), {
                message: "kiro-cli output too large",
            });
        });
    });
});

void describe("web-search provider order", () => {
    const found: Found = { answer: "42", sources: [], model: "m" };
    const answering = (name: string, calls: string[]): Provider => ({
        name,
        timeoutMs: 1000,
        search: () => {
            calls.push(name);

            return Promise.resolve(found);
        },
    });
    const failing = (name: string, reason: string, calls: string[]): Provider => ({
        name,
        timeoutMs: 1000,
        search: () => {
            calls.push(name);

            return Promise.reject(new Error(reason));
        },
    });

    void it("hands over to the next provider when one fails, and stops at the first answer", async () => {
        const calls: string[] = [];
        const outcome = await runChain(
            [
                failing("chatgpt", "not signed in with ChatGPT", calls),
                answering("anthropic", calls),
                answering("kiro", calls),
            ],
            ask,
            signal(),
        );

        assert.equal(outcome.kind, "answered");
        assert.equal(outcome.kind === "answered" ? outcome.provider : "", "anthropic");
        assert.deepEqual(calls, ["chatgpt", "anthropic"]);
    });

    void it("lists every provider's reason when all fail", async () => {
        const calls: string[] = [];
        const outcome = await runChain(
            [
                failing("chatgpt", "HTTP 429: slow down\nsecond line", calls),
                failing("anthropic", "not signed in with a Claude subscription", calls),
                failing("kiro", "kiro-cli is not installed", calls),
            ],
            ask,
            signal(),
        );

        assert.deepEqual(outcome, {
            kind: "failed",
            reasons: [
                "chatgpt: HTTP 429: slow down",
                "anthropic: not signed in with a Claude subscription",
                "kiro: kiro-cli is not installed",
            ],
        });
    });

    void it("stops the chain when the call is aborted, instead of trying the next provider", async () => {
        const controller = new AbortController();
        const calls: string[] = [];
        const hanging: Provider = {
            name: "chatgpt",
            timeoutMs: 1000,
            search: (_ask, own) => {
                calls.push("chatgpt");

                return new Promise((_resolve, reject) => {
                    own.addEventListener("abort", () => {
                        reject(new Error("aborted"));
                    });
                });
            },
        };
        const pending = runChain([hanging, answering("anthropic", calls)], ask, controller.signal);

        controller.abort();

        assert.deepEqual(await pending, { kind: "aborted" });
        assert.deepEqual(calls, ["chatgpt"]);
    });

    void it("moves on from a provider that outlasts its own timeout", async () => {
        const calls: string[] = [];
        const slow: Provider = {
            name: "chatgpt",
            timeoutMs: 20,
            search: (_ask, own) =>
                new Promise((_resolve, reject) => {
                    own.addEventListener("abort", () => {
                        reject(new Error("aborted"));
                    });
                }),
        };
        const outcome = await runChain([slow, answering("anthropic", calls)], ask, signal());

        assert.equal(outcome.kind, "answered");
        assert.deepEqual(calls, ["anthropic"]);
    });
});

void describe("web-search answer text", () => {
    void it("numbers the sources as Markdown links and names the provider", () => {
        const text = formatAnswer({
            kind: "answered",
            provider: "chatgpt",
            found: {
                answer: "Node 26 is LTS.",
                sources: [
                    { url: "https://nodejs.org/en/download", title: "Node.js [LTS] download" },
                    { url: "https://github.com/nodejs/node/releases", title: "Releases" },
                ],
                model: "gpt-6-luna",
            },
        });

        assert.equal(
            text,
            [
                "Node 26 is LTS.",
                "## Sources\n\n1. [Node.js LTS download](https://nodejs.org/en/download)\n2. [Releases](https://github.com/nodejs/node/releases)",
                "Searched with chatgpt (gpt-6-luna)",
            ].join("\n\n"),
        );
    });
});
