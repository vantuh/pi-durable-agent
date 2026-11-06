import assert from "node:assert/strict";
import { test } from "node:test";

import type { Api, AssistantMessage, Model, StopReason, Tool, Usage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitListener, Host, SessionPrompt } from "../../server/sdk.ts";
import { testHost } from "../../test/fixtures/host.ts";
import { breakdown as breakdownRef } from "./refs.ts";
import contextMeter, { actions } from "./server.ts";

const WINDOW = 200_000;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a written entry, without the harness that brands its ids
const entry = (value: object): EntryRecord => value as unknown as EntryRecord;

const asked = (id: number, text: string): EntryRecord =>
    entry({
        id,
        conversationId: id,
        kind: "pi.user",
        model: [{ role: "user", content: text, timestamp: 0 }],
    });

/** A system entry as the harness writes it: the tools that become available from that point. */
const prompted = (id: number, added: readonly string[]): EntryRecord =>
    entry({
        id,
        conversationId: id,
        kind: "pi.system",
        model: [
            {
                role: "system",
                content: "",
                timestamp: 0,
                sections: {},
                toolsAdded: added.map((name) => ({
                    name,
                    description: `what ${name} does`,
                    parameters: { type: "object", properties: {} },
                })),
            },
        ],
    });

/** An answer as generation writes it: pi-ai starts every usage at zero and fills it as the stream speaks. */
function answered(
    id: number,
    model: string,
    stopReason: StopReason,
    counted: Omit<Usage, "totalTokens" | "cost">,
): EntryRecord {
    const usage: Usage = {
        ...counted,
        totalTokens: counted.input + counted.output + counted.cacheRead + counted.cacheWrite,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "an answer" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model,
        usage,
        stopReason,
        timestamp: 0,
    };

    return entry({ id, conversationId: id, kind: "pi.assistant", model: [message] });
}

/** Which extension installed a tool: one folder with three tools, one with a single tool, and a core tool. */
const OWNERS = new Map([
    ["agent_spawn", "subagents"],
    ["agent_send", "subagents"],
    ["agent_status", "subagents"],
    ["web_search", "web-search"],
]);

const host: Host = testHost({
    name: "context-meter",
    cwd: "/work",
    dataDir: "/work",
    contextWindow: () => WINDOW,
    toolOwner: (tool) => OWNERS.get(tool),
});

/** The model a session would send to, as the core resolves it for a prompt. */
const MODEL: Model<Api> = {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://example.test",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: WINDOW,
    maxTokens: 8192,
};

/** The prompt the core renders for a session's next request, tagged as generation tags it. */
function promptOf(sections: [string, string][], tools: string[]): SessionPrompt {
    return {
        model: MODEL,
        sections: sections.map(([key, text]) => ({ key, text })),
        tools: tools.map((name): Tool => ({
            name,
            description: `what ${name} does`,
            parameters: { type: "object", properties: {} },
        })),
    };
}

/**
 * Runs the action for one session's entries, with the prompt the core would render for it: what
 * `host.sessionPrompt` answers, and the context the core reads for `host.sessionContext`. The view the server
 * publishes holds only the newest `window` of them, as Pi 1.5's does.
 */
async function breakdownOf(
    id: number,
    entries: readonly EntryRecord[],
    prompt?: SessionPrompt,
    window = entries.length,
) {
    const listeners: CommitListener[] = [];

    contextMeter({
        ...host,
        sessionPrompt: () => Promise.resolve(prompt),
        sessionContext: () => Promise.resolve(entries),
        onCommit: (listener) => listeners.push(listener),
    });
    await listeners[0]?.({
        session: { id, cwd: "/work" },
        entries: entries.slice(-window),
        busy: false,
    });

    const action = actions["breakdown"];

    assert.ok(action);

    return breakdownRef.parse(await action({ args: undefined, session: { id, cwd: "/work" } }));
}

void test("groups the tools one extension installed into one row, where its first tool was", async () => {
    const full = await breakdownOf(4, [
        prompted(1, ["agent_spawn", "web_search"]),
        prompted(2, ["agent_send", "agent_status", "bash"]),
        asked(3, "spawn two helpers"),
        answered(4, "claude-opus-4", "stop", {
            input: 10_000,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
        }),
    ]);
    const rows = full?.tools ?? [];
    const group = rows.find((row) => row.name === "subagents");

    assert.deepEqual(
        rows.map((row) => row.name),
        ["subagents", "web_search", "bash"],
    );
    assert.deepEqual(
        group?.parts?.map((child) => child.name),
        ["agent_spawn", "agent_send", "agent_status"],
    );
    assert.equal(group?.preview, "agent_spawn, agent_send, agent_status");
    assert.equal(
        group?.tokens,
        (group?.parts ?? []).reduce((sum, child) => sum + child.tokens, 0),
    );
    assert.equal(rows.find((row) => row.name === "web_search")?.parts, undefined);
    assert.equal(rows.find((row) => row.name === "bash")?.parts, undefined);
    // The rows still hold every tool once: a group counts for its children, not on top of them.
    assert.equal(
        rows.reduce((sum, row) => sum + (row.parts?.length ?? 1), 0),
        5,
    );
});

void test("measures the whole context, not the window of recent entries the view holds", async () => {
    const context = [
        prompted(1, ["agent_spawn", "web_search"]),
        asked(2, "read the whole repository"),
        answered(3, "claude-opus-4", "stop", {
            input: 9_000,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
        }),
        asked(4, "and now summarise it"),
        answered(5, "claude-opus-4", "stop", {
            input: 12_000,
            output: 200,
            cacheRead: 0,
            cacheWrite: 0,
        }),
    ];
    const whole = await breakdownOf(8, context);
    // The view's window starts at the last question: the system entry and the first answer are outside it.
    const windowed = await breakdownOf(8, context, undefined, 2);

    assert.equal(whole?.calibrated, true, "the first answer calibrates the rows");
    assert.deepEqual(
        whole?.tools.map((row) => row.name),
        ["agent_spawn", "web_search"],
        "the rows replay the system entries from the start",
    );
    assert.deepEqual(windowed, whole, "and the window changes nothing");
});

void test("reports the last priced answer when a failed request follows it", async () => {
    const full = await breakdownOf(1, [
        asked(1, "read the whole repository"),
        answered(2, "claude-opus-4", "stop", {
            input: 80_000,
            output: 1_000,
            cacheRead: 40_000,
            cacheWrite: 0,
        }),
        asked(3, "and now summarise it"),
        answered(4, "claude-opus-5", "error", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    ]);

    assert.equal(full?.used, 121_000);
    assert.equal(full?.model, "anthropic/claude-opus-4");
});

void test("reports the last priced answer when a request is stopped before its stream starts", async () => {
    const full = await breakdownOf(2, [
        asked(1, "read the whole repository"),
        answered(2, "claude-opus-4", "stop", {
            input: 80_000,
            output: 1_000,
            cacheRead: 40_000,
            cacheWrite: 0,
        }),
        asked(3, "and now summarise it"),
        answered(4, "claude-opus-5", "aborted", {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        }),
    ]);

    assert.equal(full?.used, 121_000);
    assert.equal(full?.model, "anthropic/claude-opus-4");
});

void test("counts a stop after tokens started, where the provider already priced the prompt", async () => {
    const full = await breakdownOf(3, [
        asked(1, "read the whole repository"),
        answered(2, "claude-opus-4", "stop", {
            input: 80_000,
            output: 1_000,
            cacheRead: 40_000,
            cacheWrite: 0,
        }),
        asked(3, "and now summarise it"),
        answered(4, "claude-opus-5", "aborted", {
            input: 130_000,
            output: 0,
            cacheRead: 60_000,
            cacheWrite: 0,
        }),
    ]);

    assert.equal(full?.used, 190_000);
    assert.equal(full?.model, "anthropic/claude-opus-5");
});

void test("shows what a session with nothing in it will send, marked as an estimate", async () => {
    const full = await breakdownOf(
        5,
        [],
        promptOf(
            [
                ["rules", "Project folder: /work\n\nYou are a coding agent."],
                ["notes", "<notes>\nkeep it small\n</notes>"],
            ],
            ["agent_spawn", "agent_send", "bash"],
        ),
    );

    assert.equal(full?.estimate, true);
    assert.equal(full?.calibrated, false);
    assert.equal(full?.model, "anthropic/claude-opus-4");
    assert.equal(full?.window, WINDOW);
    // The tags a tagged section carries are not part of what the row says.
    assert.deepEqual(
        full?.sections.map((section) => [section.name, section.preview]),
        [
            ["rules", "Project folder: /work You are a coding agent."],
            ["notes", "keep it small"],
        ],
    );
    // The tools are grouped as an answer's are, and the sum is every row's own tokens.
    assert.deepEqual(
        full?.tools.map((row) => row.name),
        ["subagents", "bash"],
    );
    assert.equal(full?.tools[0]?.parts?.length, 2);
    assert.equal(
        full?.used,
        [...(full?.sections ?? []), ...(full?.tools ?? [])].reduce(
            (sum, part) => sum + part.tokens,
            0,
        ),
    );
    assert.ok((full?.used ?? 0) > 0);
});

void test("has nothing to show when the core cannot name the session's model", async () => {
    assert.equal(await breakdownOf(6, []), null);
});

void test("has nothing to show for a session that holds a question but no priced answer", async () => {
    // The first question is already in the context: the first request's prompt would leave it out.
    assert.equal(
        await breakdownOf(7, [asked(7, "read the whole repository")], promptOf([], ["bash"])),
        null,
    );
});
