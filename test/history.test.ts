import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { historyPage } from "../server/history.ts";

/** The entries a view's window holds first. */
const WINDOW = 50;

/** One conversation of a throwaway session, with the entries `write` appends. */
async function withConversation(
    write: (conversation: Conversation) => Promise<void>,
    check: (conversation: Conversation) => Promise<void>,
): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "history-"));
    const harness = await Harness.open(
        await openNodeSqliteStorage(join(dir, "state.sqlite")),
        {
            models: await ModelRuntime.create(),
            registry: createRegistry(),
            env: () => new NodeExecutionEnv({ cwd: dir }),
        },
        BACKGROUND_CONTEXT,
    );

    try {
        const conversation = await harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: { model: { provider: "p", modelId: "m" }, cwd: dir },
            },
            BACKGROUND_CONTEXT,
        );

        await write(conversation);
        await check(conversation);
    } finally {
        await harness.close(BACKGROUND_CONTEXT);
        await rm(dir, { recursive: true, force: true });
    }
}

/** A turn of the shape the harness writes: a question, an answer and its tool's result. */
async function appendTurn(conversation: Conversation, ask: string): Promise<void> {
    await conversation.commit(async (tx) => {
        await tx.appendEntry(conversation.id, { kind: "pi.user", data: { text: ask } });
        await tx.appendEntry(conversation.id, { kind: "pi.assistant" });
        await tx.appendEntry(conversation.id, { kind: "pi.tool-result" });
    }, BACKGROUND_CONTEXT);
}

const ids = (entries: readonly { id: number }[]): number[] => entries.map((entry) => entry.id);

/** Every entry the conversation keeps, oldest first. */
async function logOf(conversation: Conversation): Promise<number[]> {
    const page = await conversation.entries(
        { order: "ascending" },
        1000,
        undefined,
        BACKGROUND_CONTEXT,
    );

    return ids(page.items);
}

void describe("historyPage", () => {
    void it("pages back from a compaction marker, which the view keeps in place", async () => {
        await withConversation(
            async (conversation) => {
                for (let turn = 0; turn < 6; turn += 1) {
                    await appendTurn(conversation, `question ${String(turn)}`);
                }
                // What a threshold compaction leaves behind: a marker with a head somewhere in the middle.
                await conversation.commit(
                    (tx) =>
                        tx.appendEntry(conversation.id, { kind: "pi.compaction", head: "self" }),
                    BACKGROUND_CONTEXT,
                );
                await appendTurn(conversation, "question 6");
            },
            async (conversation) => {
                const log = await logOf(conversation);
                const watch = await conversation.watch(BACKGROUND_CONTEXT);
                const marker = watch.value.entries.find((entry) => entry.kind === "pi.compaction");

                await watch.stop();

                assert.ok(marker !== undefined, "the marker is in the view");
                assert.deepEqual(
                    ids(watch.value.entries),
                    log,
                    "the view starts at the conversation's start, not at the marker",
                );

                const page = await historyPage({
                    conversation,
                    context: BACKGROUND_CONTEXT,
                    before: Number(marker.id),
                });

                assert.deepEqual(
                    ids(page.entries),
                    log.filter((id) => id < Number(marker.id)),
                    "everything before the marker comes back, oldest first",
                );
                assert.equal(page.more, false, "the conversation starts where the page starts");
            },
        );
    });

    void it("pages back one turn at a time, never starting in the middle of one", async () => {
        await withConversation(
            async (conversation) => {
                for (let turn = 0; turn < 40; turn += 1) {
                    await appendTurn(conversation, `question ${String(turn)}`);
                }
            },
            async (conversation) => {
                const before = (await conversation.context(BACKGROUND_CONTEXT)).entries.at(-1)?.id;
                assert.ok(before !== undefined);

                const seen: number[] = [];
                let cursor: number = Number(before);
                let pages = 0;

                for (;;) {
                    const page = await historyPage({
                        conversation,
                        context: BACKGROUND_CONTEXT,
                        before: cursor,
                    });

                    pages += 1;

                    for (const entry of page.entries) {
                        assert.ok(entry.id < cursor, "a page holds only what was asked for");
                        seen.push(entry.id);
                    }

                    assert.equal(
                        page.entries[0]?.kind,
                        "user",
                        "a page starts at a question, not in the middle of a turn",
                    );

                    if (!page.more) {
                        break;
                    }

                    cursor = page.entries[0]?.id ?? 0;
                }

                assert.ok(pages > 1, "the log takes more than one page");
                assert.deepEqual(
                    seen.toSorted((left, right) => left - right),
                    (await logOf(conversation)).filter((id) => id < Number(before)),
                    "every entry the browser has not got is handed out once",
                );
            },
        );
    });

    void it("hands a compaction marker to the browser with the summary it wrote", async () => {
        await withConversation(
            async (conversation) => {
                await appendTurn(conversation, "the last question before the cut");
                await conversation.commit(
                    (tx) =>
                        tx.appendEntry(conversation.id, {
                            kind: "pi.compaction",
                            head: "self",
                            model: [
                                {
                                    role: "user",
                                    timestamp: Date.now(),
                                    content: [
                                        {
                                            type: "text",
                                            text: "The conversation history before this point was compacted into the following summary:\n\n<summary>\n## Goal\nship it\n</summary>",
                                        },
                                    ],
                                },
                            ],
                        }),
                    BACKGROUND_CONTEXT,
                );
            },
            async (conversation) => {
                const newest = (
                    await conversation.entries(
                        { order: "descending" },
                        1,
                        undefined,
                        BACKGROUND_CONTEXT,
                    )
                ).items[0];
                assert.ok(newest !== undefined);

                const page = await historyPage({
                    conversation,
                    context: BACKGROUND_CONTEXT,
                    before: Number(newest.id) + 1,
                });

                assert.deepEqual(page.entries.at(-1), {
                    id: Number(newest.id),
                    kind: "compaction",
                    summary: "## Goal\nship it",
                });
            },
        );
    });

    void it("names the entry before its window, so the screen knows whether it is missing the start", async () => {
        const filler = (conversation: Conversation, count: number) =>
            conversation.commit(async (tx) => {
                for (let at = 0; at < count; at += 1) {
                    await tx.appendEntry(conversation.id, { kind: "app.filler" });
                }
            }, BACKGROUND_CONTEXT);

        await withConversation(
            (conversation) => filler(conversation, WINDOW),
            async (conversation) => {
                const watch = await conversation.watch(BACKGROUND_CONTEXT);

                await watch.stop();
                assert.equal(watch.value.entries.length, WINDOW);
                assert.equal(
                    watch.value.before,
                    undefined,
                    "a window that holds the whole log has nothing before it",
                );
            },
        );
        await withConversation(
            (conversation) => filler(conversation, WINDOW + 1),
            async (conversation) => {
                const log = await logOf(conversation);
                const watch = await conversation.watch(BACKGROUND_CONTEXT);

                await watch.stop();
                assert.deepEqual(ids(watch.value.entries), log.slice(1));
                assert.equal(
                    Number(watch.value.before),
                    log[0],
                    "one entry more than the window leaves the first one before it",
                );
            },
        );
    });

    void it("answers nothing more before the start of the conversation", async () => {
        await withConversation(
            (conversation) => appendTurn(conversation, "the only question"),
            async (conversation) => {
                assert.deepEqual(
                    await historyPage({ conversation, context: BACKGROUND_CONTEXT, before: 1 }),
                    { entries: [], more: false },
                );
            },
        );
    });
});
