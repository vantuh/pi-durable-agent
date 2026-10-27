import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClientAnswerStats, ClientEntry, ClientLive } from "../shared/protocol.ts";
import { outcomeOf, summarize, testOutcome, turnsOf } from "../web/src/lib/turns.ts";

const IDLE: ClientLive = { busy: false, usage: { input: 0, output: 0, cost: 0 } };

function stats(startedAt: number, extra: Partial<ClientAnswerStats> = {}): ClientAnswerStats {
    return {
        model: "m1",
        stopReason: "toolUse",
        input: 100,
        cached: 0,
        output: 10,
        cost: 0.01,
        startedAt,
        durationMs: 1000,
        ...extra,
    };
}

const call = (id: string, name: string, args: unknown) =>
    ({ type: "toolCall", id, name, args }) as const;

const result = (id: number, callId: string, isError = false, at = 0): ClientEntry => ({
    id,
    kind: "toolResult",
    callId,
    name: "read",
    text: "out",
    isError,
    at,
});

void describe("turnsOf", () => {
    void it("folds calls across answers into one group until words end it", () => {
        const entries: ClientEntry[] = [
            { id: 1, kind: "user", text: "hi", at: 1000 },
            {
                id: 2,
                kind: "assistant",
                blocks: [{ type: "thinking", text: "hmm" }, call("a", "read", { path: "x.ts" })],
                stats: stats(1000, { cached: 40 }),
            },
            result(3, "a", false, 2500),
            {
                id: 4,
                kind: "assistant",
                blocks: [call("b", "bash", { command: "ls" }), { type: "text", text: "Done." }],
                stats: stats(3000, {
                    stopReason: "stop",
                    input: 300,
                    cached: 200,
                    cost: 0.02,
                }),
            },
            result(5, "b", true, 4500),
        ];

        const [turn] = turnsOf(entries, IDLE);

        assert.ok(turn !== undefined);
        assert.deepEqual(
            turn.items.map((item) => item.type),
            ["activity", "reply"],
        );

        const group = turn.items[0];

        assert.ok(group?.type === "activity");
        assert.deepEqual(
            group.steps.map((step) => (step.kind === "tool" ? step.status : step.kind)),
            ["thinking", "done", "error"],
        );
        assert.equal(group.endedAt, 4500);
        assert.equal(summarize(group.steps, false), "Thought, read 1 file and ran 1 command");
        assert.deepEqual(turn.stats, {
            model: "m1",
            responses: 2,
            context: 300,
            cached: 200,
            output: 20,
            cost: 0.03,
            startedAt: 1000,
            endedAt: 4000,
        });
    });

    void it("says a call without a result stopped, unless the run can still reach it", () => {
        const entries: ClientEntry[] = [
            { id: 1, kind: "user", text: "hi" },
            { id: 2, kind: "assistant", blocks: [call("a", "edit", { path: "y" })] },
        ];
        const statusOf = (live: ClientLive) => {
            const item = turnsOf(entries, live)[0]?.items[0];

            return item?.type === "activity" && item.steps[0]?.kind === "tool"
                ? item.steps[0].status
                : undefined;
        };

        assert.equal(statusOf(IDLE), "stopped");
        assert.equal(statusOf({ ...IDLE, busy: true }), "pending");
        assert.equal(
            statusOf({
                ...IDLE,
                busy: true,
                tools: [{ callId: "a", name: "edit", status: "running" }],
            }),
            "running",
        );
    });

    void it("keeps a group's key when the streamed answer is stored", () => {
        const user: ClientEntry = { id: 1, kind: "user", text: "hi" };
        const blocks = [call("a", "read", { path: "x" })];
        const streaming = turnsOf([user], { ...IDLE, busy: true, blocks });
        const stored = turnsOf([user, { id: 2, kind: "assistant", blocks }], {
            ...IDLE,
            busy: true,
        });

        assert.equal(streaming[0]?.items[0]?.key, stored[0]?.items[0]?.key);
        assert.equal(streaming[0]?.live, true);
    });

    void it("keeps the messages on both sides of a compaction, split where it cut", () => {
        const entries: ClientEntry[] = [
            { id: 1, kind: "user", text: "before" },
            { id: 2, kind: "assistant", blocks: [{ type: "text", text: "an answer" }] },
            { id: 3, kind: "compaction", summary: "## Goal\nship it" },
            { id: 4, kind: "user", text: "after" },
        ];

        const turns = turnsOf(entries, IDLE);

        assert.deepEqual(
            turns.map((turn) => turn.user?.text ?? "compacted"),
            ["before", "compacted", "after"],
            "the marker sits between the messages it was written between",
        );
        assert.equal(turns[1]?.compacted?.summary, "## Goal\nship it");
        assert.equal(turns[1]?.items.length, 0, "and carries no answer of its own");
        assert.equal(new Set(turns.map((turn) => turn.key)).size, 3, "keys stay unique");
        assert.equal(turns[2]?.compacted, undefined, "and does not leak into the turn after it");
    });
});

void describe("outcomeOf", () => {
    const step = (name: string, args: unknown, text: string, isError = false) =>
        ({
            kind: "tool",
            key: "k",
            id: "c",
            name,
            args,
            status: isError ? "error" : "done",
            result: { id: 1, kind: "toolResult", callId: "c", name, text, isError },
        }) as const;

    void it("counts lines, edits, and says how a call failed", () => {
        assert.deepEqual(outcomeOf(step("read", { path: "a" }, "1\n2\n3")), { text: "3 lines" });
        assert.deepEqual(outcomeOf(step("bash", { command: "true" }, "")), { text: "no output" });
        assert.deepEqual(
            outcomeOf(step("edit", { edits: [{ oldText: "a", newText: "b\nc" }] }, "ok")),
            { text: "+2 \u22121", tone: "ok", counts: { added: 2, removed: 1 } },
        );
        assert.deepEqual(outcomeOf(step("bash", {}, "\nexit 1\nmore", true)), {
            text: "exit 1",
            tone: "danger",
        });
        assert.deepEqual(
            outcomeOf(
                step("bash", {}, "<harness>\n[error] Tool bash was aborted\n</harness>", true),
            ),
            { text: "stopped", tone: "danger" },
        );
    });
});

void describe("testOutcome", () => {
    void it("reads node's, Jest's and mocha's summaries", () => {
        assert.deepEqual(
            testOutcome("ℹ tests 49\nℹ pass 48\nℹ fail 1\nℹ duration_ms 3112.5", "pnpm test"),
            { text: "48 passed · 1 failed · 3.1s", passed: 48, failed: 1 },
        );
        assert.equal(
            testOutcome(
                "Tests:       2 failed, 47 passed, 49 total\nTime:        12.4 s",
                "npx jest",
            )?.text,
            "47 passed · 2 failed · 12s",
        );
        assert.equal(testOutcome("  12 passing (40ms)", "npx mocha")?.text, "12 passed");
    });

    void it("says nothing for a command that is not a test run", () => {
        assert.equal(testOutcome("3 passed the check", "ls"), undefined);
    });

    void it("shows a failed run's counts, not its exit code", () => {
        const step = {
            kind: "tool",
            key: "k",
            id: "c",
            name: "bash",
            args: { command: "node --test test/" },
            status: "error",
            result: {
                id: 1,
                kind: "toolResult",
                callId: "c",
                name: "bash",
                text: "ℹ pass 46\nℹ fail 2\n\nCommand exited with code 1",
                isError: true,
            },
        } as const;

        assert.deepEqual(outcomeOf(step), { text: "46 passed · 2 failed", tone: "danger" });
    });
});

void describe("summarize", () => {
    const bash = (key: string, command: string) =>
        ({ kind: "tool", key, id: key, name: "bash", args: { command }, status: "done" }) as const;

    void it("says a group committed, and leaves that command out of the plain runs", () => {
        assert.equal(
            summarize(
                [bash("a", "git add -A && git commit -m 'x'"), bash("b", "pnpm test")],
                false,
            ),
            "Committed and ran 1 command",
        );
    });

    void it("does not read the word in another argument as a commit", () => {
        assert.equal(
            summarize([bash("a", "git log --grep=commit -1"), bash("b", "cat commit.md")], false),
            "Ran 2 commands",
        );
    });
});
