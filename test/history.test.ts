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
    void it("reaches the entries a compaction set aside, which the view no longer carries", async () => {
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
                const view = await conversation.viewState(BACKGROUND_CONTEXT);
                const marker = view.value.entries[0];

                assert.equal(
                    marker?.kind,
                    "pi.compaction",
                    "the view starts at the compaction marker",
                );
                assert.equal(view.value.entries.length, 4, "and holds nothing from before it");

                const page = await historyPage({
                    conversation,
                    context: BACKGROUND_CONTEXT,
                    before: Number(marker?.id),
                });

                assert.deepEqual(
                    ids(page.entries),
                    (await logOf(conversation)).filter((id) => id < Number(marker?.id)),
                    "everything the compaction set aside comes back, oldest first",
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
