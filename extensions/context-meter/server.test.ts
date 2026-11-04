import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantMessage, StopReason, Usage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

import type { CommitListener, Host } from "../../server/sdk.ts";
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

const host: Host = {
    name: "context-meter",
    cwd: "/work",
    dataDir: "/work",
    log: () => undefined,
    onCommit: () => undefined,
    onDispose: () => undefined,
    shapeModelRequests: () => undefined,
    registerModelProvider: () => () => undefined,
    wrapModelFetch: () => undefined,
    resolveModelAuth: () => Promise.resolve(undefined),
    contextWindow: () => WINDOW,
    sessionRequest: () => Promise.resolve(undefined),
    sessionTitle: () => Promise.resolve(null),
    sessionName: () => Promise.resolve(null),
    sessionOwner: () => Promise.resolve(undefined),
    sessionSeen: () => Promise.resolve(false),
    setSessionTitle: () => Promise.resolve(),
    readDoc: (doc) => Promise.resolve(doc.definition.initial()),
    setSessionMark: () => undefined,
    toolOwner: (tool) => OWNERS.get(tool),
    folderGroup: () => undefined,
    notifySessionChanged: () => undefined,
    notify: () => undefined,
};

const commits: CommitListener[] = [];

contextMeter({ ...host, onCommit: (listener) => commits.push(listener) });

async function breakdownOf(id: number, entries: readonly EntryRecord[]) {
    await commits[0]?.({ session: { id, cwd: "/work" }, entries, busy: false });

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
