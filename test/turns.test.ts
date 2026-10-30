import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
    ClientAnswerStats,
    ClientEntry,
    ClientImage,
    ClientLive,
} from "../shared/protocol.ts";
import type { Item, Step, Turn, TurnStats } from "../web/src/lib/turns.ts";
import {
    imagesOf,
    outcomeOf,
    sameTurn,
    summarize,
    testOutcome,
    turnsOf,
} from "../web/src/lib/turns.ts";

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

/**
 * `sameTurn` is what the screen's memo on a turn asks: a chunk of a streamed answer builds every turn anew, and a turn
 * that shows the same thing must not render again — while one that shows something new must.
 */
void describe("sameTurn", () => {
    /** The turn at `index`, which each fixture below has. */
    const at = (turns: Turn[], index: number): Turn => {
        const turn = turns[index];

        assert.ok(turn !== undefined, `turn ${String(index)}`);

        return turn;
    };
    const question: ClientEntry = { id: 1, kind: "user", text: "hi", at: 1000 };
    const listed: ClientEntry[] = [
        question,
        { id: 2, kind: "assistant", blocks: [{ type: "text", text: "hello" }], stats: stats(1000) },
        { id: 3, kind: "user", text: "again", at: 3000 },
    ];

    void it("holds a turn that the answer arriving at the end cannot change", () => {
        const before = turnsOf(listed, IDLE);
        const streaming = turnsOf(listed, {
            ...IDLE,
            busy: true,
            startedAt: 3000,
            blocks: [{ type: "text", text: "an answer, one chunk at a time" }],
        });

        assert.equal(
            sameTurn(at(before, 0), at(streaming, 0)),
            true,
            "a settled turn is built anew by every chunk and shows the same",
        );
        assert.equal(
            sameTurn(at(before, 1), at(streaming, 1)),
            false,
            "the turn at the end shows the chunk",
        );
        assert.equal(
            at(before, 0).user,
            question,
            "a turn keeps the entry it came from, so the memo can compare it by reference",
        );
    });

    void it("says a turn changed when any one thing it shows changed", () => {
        const args = { path: "x" };
        const entries: ClientEntry[] = [
            question,
            {
                id: 2,
                kind: "assistant",
                blocks: [
                    { type: "thinking", text: "hmm" },
                    call("a", "read", args),
                    { type: "text", text: "an answer" },
                ],
                stats: stats(1000),
                error: "the provider gave up",
            },
            result(3, "a", false, 2000),
            { id: 4, kind: "compaction", summary: "so far" },
            { id: 5, kind: "user", text: "after", at: 4000 },
        ];
        const turns = turnsOf(entries, IDLE);
        /** A turn with the run's mark, a group, words, an error and the counts, and one that only marks a compaction. */
        const shown = at(turns, 0);
        const cut = at(turns, 1);
        const group = (turn: Turn): Extract<Item, { type: "activity" }> => {
            const item = turn.items[0];

            assert.ok(item?.type === "activity", "the turn starts with a group");

            return item;
        };
        const thought = (turn: Turn): Extract<Step, { kind: "thinking" }> => {
            const step = group(turn).steps[0];

            assert.ok(step?.kind === "thinking", "the group starts with the thinking");

            return step;
        };
        const reading = (turn: Turn): Extract<Step, { kind: "tool" }> => {
            const step = group(turn).steps[1];

            assert.ok(step?.kind === "tool", "the group's call comes second");

            return step;
        };
        const counted = (turn: Turn): TurnStats => {
            assert.ok(turn.stats !== undefined, "the turn counts its spend");

            return turn.stats;
        };
        const words = (turn: Turn): Extract<Item, { type: "reply" }> => {
            const item = turn.items.find((each) => each.type === "reply");

            assert.ok(item?.type === "reply", "the turn answers in words");

            return item;
        };
        /** The turn as `turnsOf` builds it again: new containers, the entries a turn keeps still the same objects. */
        const again = (turn: Turn): Turn => ({
            ...turn,
            ...(turn.user === undefined ? {} : { user: turn.user }),
            ...(turn.compacted === undefined ? {} : { compacted: { ...turn.compacted } }),
            ...(turn.stats === undefined ? {} : { stats: { ...turn.stats } }),
            items: turn.items.map((item) =>
                item.type === "activity"
                    ? { ...item, steps: item.steps.map((step) => ({ ...step })) }
                    : { ...item },
            ),
        });

        /** Every field of the counts is one the answer's header shows. */
        const counts: [string, (state: TurnStats) => void][] = [
            [
                "the model",
                (state) => {
                    state.model = "m2";
                },
            ],
            [
                "the thinking level",
                (state) => {
                    state.thinkingLevel = "high";
                },
            ],
            [
                "the responses",
                (state) => {
                    state.responses += 1;
                },
            ],
            [
                "the context",
                (state) => {
                    state.context += 1;
                },
            ],
            [
                "the cache",
                (state) => {
                    state.cached += 1;
                },
            ],
            [
                "the output",
                (state) => {
                    state.output += 1;
                },
            ],
            [
                "the spend",
                (state) => {
                    state.cost += 1;
                },
            ],
            [
                "the start",
                (state) => {
                    state.startedAt = 1;
                },
            ],
            [
                "the end",
                (state) => {
                    state.endedAt = 1;
                },
            ],
        ];

        for (const [what, change] of counts) {
            const changed = again(shown);

            change(counted(changed));
            assert.equal(sameTurn(shown, changed), false, what);
        }

        assert.equal(sameTurn(shown, again(shown)), true, "built again, a turn shows the same");
        assert.equal(
            reading(shown).args,
            args,
            "a turn keeps the arguments the entry holds, so the memo can compare them by reference",
        );
        assert.equal(
            sameTurn(cut, again(cut)),
            true,
            "and so does one that only marks a compaction",
        );

        const changes: [string, Turn, (turn: Turn) => void][] = [
            [
                "the run's mark",
                shown,
                (turn) => {
                    turn.live = !turn.live;
                },
            ],
            [
                "what the person asked",
                shown,
                (turn) => {
                    turn.user = { ...question, text: "another question" };
                },
            ],
            [
                "the group's clock",
                shown,
                (turn) => {
                    group(turn).startedAt = 1;
                },
            ],
            [
                "the group's end",
                shown,
                (turn) => {
                    group(turn).endedAt = 1;
                },
            ],
            [
                "the group's mark",
                shown,
                (turn) => {
                    group(turn).live = !group(turn).live;
                },
            ],
            [
                "a thought's words",
                shown,
                (turn) => {
                    thought(turn).text = "other";
                },
            ],
            [
                "a thought arriving",
                shown,
                (turn) => {
                    thought(turn).streaming = !thought(turn).streaming;
                },
            ],
            [
                "a call's name",
                shown,
                (turn) => {
                    reading(turn).name = "bash";
                },
            ],
            [
                "a call's status",
                shown,
                (turn) => {
                    reading(turn).status = "error";
                },
            ],
            [
                "a call's arguments",
                shown,
                (turn) => {
                    reading(turn).args = { path: "y" };
                },
            ],
            [
                "a call's result",
                shown,
                (turn) => {
                    reading(turn).result = {
                        id: 9,
                        kind: "toolResult",
                        callId: "a",
                        name: "read",
                        text: "other",
                        isError: false,
                    };
                },
            ],
            [
                "the answer's words",
                shown,
                (turn) => {
                    words(turn).text = "another";
                },
            ],
            [
                "the answer arriving",
                shown,
                (turn) => {
                    const item = words(turn);

                    item.streaming = !item.streaming;
                },
            ],
            [
                "the error it shows",
                shown,
                (turn) => {
                    const item = turn.items.find((each) => each.type === "error");

                    if (item?.type === "error") {
                        item.text = "another";
                    }
                },
            ],
            [
                "a step more",
                shown,
                (turn) => {
                    group(turn).steps.push({
                        kind: "thinking",
                        key: "t1:a0:9",
                        text: "more",
                        streaming: false,
                    });
                },
            ],
            [
                "a step fewer",
                shown,
                (turn) => {
                    group(turn).steps.pop();
                },
            ],
            [
                "an item more",
                shown,
                (turn) => {
                    turn.items.push({
                        type: "reply",
                        key: "t1:r9",
                        text: "more",
                        streaming: false,
                    });
                },
            ],
            [
                "an item fewer",
                shown,
                (turn) => {
                    turn.items.pop();
                },
            ],
            [
                "the compaction's summary",
                cut,
                (turn) => {
                    if (turn.compacted !== undefined) {
                        turn.compacted.summary = "another";
                    }
                },
            ],
            [
                "a marker with nothing to open",
                cut,
                (turn) => {
                    turn.compacted = {};
                },
            ],
        ];

        for (const [what, turn, change] of changes) {
            const changed = again(turn);

            change(changed);
            assert.equal(sameTurn(turn, changed), false, what);
        }
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

    void it("says a call returned pictures, not how many lines of notice came with them", () => {
        const read = step("read", { path: "a.png" }, "[info] Read image file [image/png].");

        assert.deepEqual(
            outcomeOf({ ...read, result: { ...read.result, images: [{ mimeType: "image/png" }] } }),
            { text: "1 image" },
        );
    });

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

void describe("imagesOf", () => {
    const tool = (id: string, entry: number, images?: ClientImage[]): Step => ({
        kind: "tool",
        key: id,
        id,
        name: "read",
        args: {},
        status: "done",
        result: {
            id: entry,
            kind: "toolResult",
            callId: id,
            name: "read",
            text: "[info] Read image file [image/png].",
            isError: false,
            ...(images === undefined ? {} : { images }),
        },
    });

    void it("gathers every picture of a group's calls, in the order they came", () => {
        const png: ClientImage = { mimeType: "image/png" };
        const steps: Step[] = [
            tool("a", 7, [png, png]),
            tool("b", 9),
            { kind: "thinking", key: "t", text: "hmm", streaming: false },
            tool("c", 11, [png]),
        ];

        assert.deepEqual(imagesOf(steps), [
            { entry: 7, index: 0, name: "read image 1" },
            { entry: 7, index: 1, name: "read image 2" },
            { entry: 11, index: 0, name: "read image 1" },
        ]);
        assert.deepEqual(imagesOf([]), [], "a group without pictures has no strip");
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

    void it("says a read of a SKILL.md loaded a skill, and a read of another file did not", () => {
        const read = (key: string, path: string) =>
            ({ kind: "tool", key, id: key, name: "read", args: { path }, status: "done" }) as const;

        assert.equal(
            summarize(
                [read("a", "/home/me/.pi/agent/skills/tdd/SKILL.md"), read("b", "/w/SKILL.md.bak")],
                false,
            ),
            "Loaded 1 skill and read 1 file",
        );
    });

    void it("does not read the word in another argument as a commit", () => {
        assert.equal(
            summarize([bash("a", "git log --grep=commit -1"), bash("b", "cat commit.md")], false),
            "Ran 2 commands",
        );
    });
});
