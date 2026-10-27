// Test: the transcript the title model reads, the cleanup of its answer, and when a run names a session.
// Run: pnpm test

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
    Api,
    AssistantMessage,
    Message,
    Model,
    ModelThinkingLevel,
} from "@earendil-works/pi-ai";

import type { CommitListener, Host, SessionSendOptions } from "../../server/sdk.ts";
import { buildTitleTranscript, parseGeneratedSessionTitle } from "./lib.ts";
import autoSessionName, { actions } from "./server.ts";
import { writeAuto } from "./store.ts";

void test("cleans the model's answer into a title", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
        ["标题：修复 SSE 重连。", "修复 SSE 重连"],
        ["Назва: Виправлення реконекту", "Виправлення реконекту"],
        ["заголовок - Міграція", "Міграція"],
        ["Title: Fix login bug", "Fix login bug"],
        ['```json\n{"title":"整理 Session 文件夹"}\n```', "整理 Session 文件夹"],
        ["```\nFix login bug\n```", "Fix login bug"],
        ['"Improve worktree session grouping"', "Improve worktree session grouping"],
        ["«Дві черги»", "«Дві черги»"],
        ["Fix login bug.\nSecond line is dropped.", "Fix login bug"],
        ["  Дві   черги  ", "Дві черги"],
    ];

    for (const [raw, expected] of cases) {
        assert.equal(parseGeneratedSessionTitle(raw), expected, raw);
    }
});

void test("caps a title at 80 code points", () => {
    assert.equal(Array.from(parseGeneratedSessionTitle("я".repeat(200))).length, 80);
});

void test("rejects an answer that is not a title", () => {
    for (const raw of ["...", "```\n---\n```", "   ", ""]) {
        assert.throws(() => parseGeneratedSessionTitle(raw), raw);
    }
});

void test("rejects malformed JSON and JSON without a string title", () => {
    for (const raw of [
        '{"title":42}',
        '{"title":null}',
        '{"error":"not a title"}',
        "{broken json",
        '```json\n{"error":"not a title"}\n```',
    ]) {
        assert.throws(() => parseGeneratedSessionTitle(raw), raw);
    }
});

function user(text: string): Message {
    return { role: "user", content: text, timestamp: 0 };
}

function toolResult(): Message {
    return {
        role: "toolResult",
        toolCallId: "1",
        toolName: "read",
        content: [{ type: "text", text: "TOOL OUTPUT" }],
        isError: false,
        timestamp: 0,
    };
}

void test("drops a tool result and clips a long user turn", () => {
    const transcript = buildTitleTranscript([
        user(`${"first ".repeat(199)}last`),
        answer("working on it"),
        toolResult(),
        answer("Done: added the retry wrapper"),
    ]);

    assert.ok(!transcript.includes("TOOL OUTPUT"));
    assert.ok(transcript.includes("Assistant: Done: added the retry wrapper"));
    assert.ok(transcript.startsWith("User: "));

    const [userLine] = transcript.split("\n\n");

    assert.equal(userLine?.length, "User: ".length + 800 + 1);
    assert.ok(userLine?.endsWith("…"));
});

void test("clips an intermediate reply at 300 and keeps the newest at 600", () => {
    const long = "x".repeat(500);
    const transcript = buildTitleTranscript([
        user("do the thing"),
        answer(long),
        answer([{ type: "toolCall", id: "1", name: "read", arguments: {} }]),
    ]);

    assert.ok(transcript.includes(long), "a tool-call-only reply does not take the larger cap");

    const clipped = buildTitleTranscript([
        user("do the thing"),
        answer(long),
        answer("final reply"),
    ]);

    assert.ok(!clipped.includes("x".repeat(301)));
});

void test("bounds a long session to its budget, keeping both ends", () => {
    const messages: Message[] = [];

    for (let index = 0; index < 40; index += 1) {
        messages.push(user(`turn ${String(index)} ${"y".repeat(300)}`));
        messages.push(answer(`reply ${String(index)}`));
    }

    const transcript = buildTitleTranscript(messages);

    assert.ok(transcript.length <= 6000);
    assert.ok(transcript.includes("[…]"));
    assert.ok(transcript.includes("User: turn 0"));
    assert.ok(transcript.includes("reply 39"));
});

type Recorded = { options: SessionSendOptions | undefined; content: unknown };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a hand-made model, without the catalog that types one
const model = {
    id: "test-model",
    provider: "test",
    api: "test",
    reasoning: false,
} as unknown as Model<Api>;

function answer(
    content: string | AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
    return {
        role: "assistant",
        api: "test",
        provider: "test",
        model: "test",
        stopReason,
        timestamp: 0,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    };
}

/**
 * A host that hands back one answer from the title model and records what was asked. `renamedWhile`
 * lands inside the request, as a name chosen while the title was being generated.
 */
function hostOf(options: {
    dir: string;
    named?: string;
    renamedWhile?: string;
    stop?: AssistantMessage["stopReason"];
    model?: Model<Api>;
    recorded: Recorded[];
}) {
    const commits: CommitListener[] = [];
    const names: string[] = [];
    let name: string | null = options.named ?? null;

    const host: Host = {
        name: "auto-session-name",
        cwd: options.dir,
        dataDir: options.dir,
        log: () => undefined,
        onCommit: (listener) => {
            commits.push(listener);
        },
        onDispose: () => undefined,
        shapeModelRequests: () => undefined,
        wrapModelFetch: () => undefined,
        resolveModelAuth: () => Promise.resolve(undefined),
        contextWindow: () => undefined,
        sessionTitle: () => Promise.resolve(name),
        sessionName: () => Promise.resolve(name),
        setSessionTitle: (_session, title) => {
            names.push(title);
            name = title;

            return Promise.resolve();
        },
        sessionRequest: () =>
            Promise.resolve({
                model: options.model ?? model,
                messages: [
                    { role: "user", content: "how do I plug mcp in", timestamp: 0 },
                    answer("here is how"),
                ],
                send: (messages, _signal, sent) => {
                    options.recorded.push({ options: sent, content: messages[0]?.content });

                    if (options.renamedWhile !== undefined) {
                        name = options.renamedWhile;
                    }

                    return Promise.resolve(answer("Fix the MCP config.", options.stop ?? "stop"));
                },
            }),
    };

    const commit = async (busy: boolean): Promise<void> => {
        await commits[0]?.({ session: { id: 1, cwd: options.dir }, entries: [], busy });
    };

    return { host, commit, names };
}

const asked = (recorded: Recorded[]): string => JSON.stringify(recorded[0]?.content ?? "");

void test("names an unnamed session when a run ends, on a request of its own", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        await writeAuto(dir, true);

        const { host, commit, names } = hostOf({ dir, recorded });

        await autoSessionName(host);
        await commit(true);
        await commit(false);

        assert.deepEqual(names, ["Fix the MCP config"]);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0]?.options?.maxTokens, 512);
        assert.equal(recorded[0]?.options?.cacheRetention, "none");
        assert.equal(recorded[0]?.options?.reasoning, "off");
        assert.match(recorded[0]?.options?.systemPrompt ?? "", /You name chat sessions/);
        assert.match(asked(recorded), /how do I plug mcp in/);
        assert.match(asked(recorded), /Create a concise title/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("uses the cheapest supported thinking level for naming", async () => {
    const cases: ReadonlyArray<readonly [Model<Api>, ModelThinkingLevel]> = [
        [{ ...model, reasoning: true }, "off"],
        [{ ...model, reasoning: true, thinkingLevelMap: { off: null, minimal: null } }, "low"],
        [{ ...model, reasoning: true, api: "google-generative-ai" }, "low"],
    ];
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));

    try {
        for (const [selected, expected] of cases) {
            const recorded: Recorded[] = [];
            const { host } = hostOf({ dir, recorded, model: selected });
            const generate = actions(host)["generate"];
            assert.ok(generate);

            await generate({ args: undefined, session: { id: 1, cwd: dir } });

            assert.equal(recorded[0]?.options?.reasoning, expected);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("leaves a session that was already named alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        await writeAuto(dir, true);

        const { host, commit, names } = hostOf({ dir, recorded, named: "mine" });

        await autoSessionName(host);
        await commit(true);
        await commit(false);

        assert.deepEqual(names, []);
        assert.deepEqual(recorded, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("names nothing while the setting is off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        const { host, commit, names } = hostOf({ dir, recorded });

        await autoSessionName(host);
        await commit(true);
        await commit(false);

        assert.deepEqual(names, []);
        assert.deepEqual(recorded, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("keeps a name that landed while the title was generated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        await writeAuto(dir, true);

        const { host, commit, names } = hostOf({ dir, recorded, renamedWhile: "chosen by hand" });

        await autoSessionName(host);
        await commit(true);
        await commit(false);

        assert.deepEqual(names, []);
        assert.equal(recorded.length, 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("a failed model call leaves the session unnamed, and the menu item says why", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        await writeAuto(dir, true);

        const { host, commit, names } = hostOf({ dir, recorded, stop: "error" });
        const generate = actions(host)["generate"];

        assert.ok(generate);

        await autoSessionName(host);
        await commit(true);
        await commit(false);

        assert.deepEqual(names, []);
        assert.deepEqual(recorded.length, 1);
        await assert.rejects(
            async () => await generate({ args: undefined, session: { id: 1, cwd: dir } }),
            /The title model request failed/,
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("the menu item replaces a name the session already has", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));
    const recorded: Recorded[] = [];

    try {
        const { host, names } = hostOf({ dir, recorded, named: "chosen by hand" });
        const generate = actions(host)["generate"];

        assert.ok(generate);
        assert.deepEqual(await generate({ args: undefined, session: { id: 1, cwd: dir } }), {
            title: "Fix the MCP config",
        });
        assert.deepEqual(names, ["Fix the MCP config"]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

void test("turns automatic naming on and off, and remembers it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-session-name-"));

    try {
        const { host } = hostOf({ dir, recorded: [] });
        const setAuto = actions(host)["setAuto"];

        await autoSessionName(host);
        assert.ok(setAuto);
        assert.deepEqual(await actions(host)["settings"]?.({ args: undefined, session: null }), {
            auto: false,
        });
        assert.deepEqual(await setAuto({ args: { auto: true }, session: null }), { auto: true });
        await assert.rejects(async () => await setAuto({ args: {}, session: null }), /auto/);

        const { host: reloaded } = hostOf({ dir, recorded: [] });

        await autoSessionName(reloaded);
        assert.deepEqual(
            await actions(reloaded)["settings"]?.({ args: undefined, session: null }),
            {
                auto: true,
            },
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
