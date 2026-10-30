/**
 * Conversations as the browser sees them: a list, a folder each, an agent each. The harness owns the
 * conversations; this file only opens them, names them after their first question, and remembers which
 * folder each one works in.
 */

import type { Context } from "@earendil-works/chord/context";
import { type Api, clampThinkingLevel, type Model } from "@earendil-works/pi-ai";
import {
    AgentDoc,
    type Conversation,
    type ConversationDocToken,
    type ConversationId,
    type Cursor,
    defineDoc,
    type Harness,
    type JsonObject,
    type Tx,
} from "@earendil-works/pi-durable";

import type { SessionSummary } from "../shared/protocol.ts";
import { projectEntry } from "./projection.ts";

/** When a person last wrote to a session, or created it. 0 until something sets it. */
const ClockDoc = defineDoc({
    kind: "app.clock",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ activeAt: 0 }),
    checkpointWhen: () => true,
});

/** Sidebar visibility only; archiving never changes the agent's lifecycle. */
const ArchiveDoc = defineDoc({
    kind: "app.archive",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { archived: boolean } => ({ archived: false }),
    checkpointWhen: () => true,
});

/** When the latest run ended and when a person last saw the session, both on the server's clock. */
const AttentionDoc = defineDoc({
    kind: "app.attention",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ endedAt: 0, seenAt: 0 }),
    checkpointWhen: () => true,
});

/** Gone from the list for good. The rows stay where they are; only the sidebar forgets the session. */
const DeletedDoc = defineDoc({
    kind: "app.deleted",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { deleted: boolean } => ({ deleted: false }),
    checkpointWhen: () => true,
});

/** A name chosen by hand. Empty means none: the session is named after its first question. */
const TitleDoc = defineDoc({
    kind: "app.title",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { title: string } => ({ title: "" }),
    checkpointWhen: () => true,
});

/** The model a new session starts with. Empty strings mean "none chosen": the `MODEL` variable rules. */
const SettingsDoc = defineDoc({
    kind: "app.settings",
    version: 1,
    scope: "session",
    initial: () => ({ provider: "", modelId: "", thinkingLevel: "" }),
    checkpointWhen: () => true,
});

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type Opened = {
    id: ConversationId;
    conversation: Conversation;
    sent: number[];
    watched: boolean;
};

type ModelRef = { provider: string; modelId: string };

export type ModelCatalog = {
    getModel: (provider: string, modelId: string) => Model<Api> | undefined;
};

/** The level Pi would use for the model: a level it does not support is not sent at all, so the provider picks. */
export function supportedLevel(
    models: ModelCatalog,
    model: ModelRef,
    level: ThinkingLevel,
): ThinkingLevel {
    const known = models.getModel(model.provider, model.modelId);

    return known === undefined ? level : clampThinkingLevel(known, level);
}

/** A session's name is one line: the first question can be a paragraph. */
function oneLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** The first question in the log, cut: what a session is called until someone names it. */
async function firstQuestion(tx: Tx, id: ConversationId): Promise<string | null> {
    const page = await tx.scanEntries({ conversationId: id, order: "ascending" }, 5);

    for (const record of page.items) {
        const entry = projectEntry(record);

        if (entry.kind === "user") {
            const line = oneLine(entry.text);

            if (line !== "") {
                return line.slice(0, 80);
            }
        }
    }

    return null;
}

/**
 * The start time of a session's newest message, which the model message carries, stored in the clock as it is
 * read: a session older than the clock has no other time. Null when it has no message either.
 */
async function stamped(tx: Tx, id: ConversationId): Promise<number | null> {
    const page = await tx.scanEntries({ conversationId: id, order: "descending" }, 1);
    const stamp = page.items[0]?.model?.[0]?.timestamp;

    if (stamp === undefined) {
        return null;
    }

    (await tx.doc(ClockDoc, id)).activeAt = stamp;

    return stamp;
}

export class Sessions {
    readonly #harness: Harness;
    readonly #model: ModelRef;
    readonly #models: ModelCatalog;
    readonly #context: Context;
    readonly #open = new Map<ConversationId, Opened>();
    /** The first question of a conversation, once it has one: it never changes, and names the session. */
    readonly #questions = new Map<ConversationId, string>();

    constructor(options: {
        harness: Harness;
        model: ModelRef;
        models: ModelCatalog;
        context: Context;
    }) {
        this.#harness = options.harness;
        this.#model = options.model;
        this.#models = options.models;
        this.#context = options.context;
    }

    async create(cwd: string): Promise<Conversation> {
        const chosen = await this.defaults();
        const model = chosen?.model ?? this.#model;
        const conversation = await this.#harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: {
                    model,
                    cwd,
                    thinkingLevel: supportedLevel(
                        this.#models,
                        model,
                        chosen?.thinkingLevel ?? "off",
                    ),
                },
            },
            this.#context,
        );

        await this.touch(conversation.id);

        return conversation;
    }

    /** The model chosen with "Make default", if any. */
    async defaults(): Promise<
        { model: { provider: string; modelId: string }; thinkingLevel: ThinkingLevel } | undefined
    > {
        const stored = await this.#harness.commit(async (tx) => {
            const doc = await tx.doc(SettingsDoc);

            return { provider: doc.provider, modelId: doc.modelId, level: doc.thinkingLevel };
        }, this.#context);
        const thinkingLevel = THINKING_LEVELS.find((level) => level === stored.level);

        return stored.provider === "" || stored.modelId === "" || thinkingLevel === undefined
            ? undefined
            : { model: { provider: stored.provider, modelId: stored.modelId }, thinkingLevel };
    }

    async setDefaults(
        model: { provider: string; modelId: string },
        thinkingLevel: ThinkingLevel,
    ): Promise<void> {
        await this.#harness.commit(async (tx) => {
            const doc = await tx.doc(SettingsDoc);

            doc.provider = model.provider;
            doc.modelId = model.modelId;
            doc.thinkingLevel = thinkingLevel;
        }, this.#context);
    }

    /** Records that a person just wrote to the session. */
    async touch(id: ConversationId): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(ClockDoc, id)).activeAt = Date.now();
        }, this.#context);
    }

    async ended(id: ConversationId, at: number): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(AttentionDoc, id)).endedAt = at;
        }, this.#context);
    }

    async seen(id: ConversationId): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(AttentionDoc, id)).seenAt = Date.now();
        }, this.#context);
    }

    async setArchived(id: ConversationId, archived: boolean): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(ArchiveDoc, id)).archived = archived;
        }, this.#context);
    }

    /** Deleting stops the session's run and marks it: the transcript stays in storage, out of every list. */
    async delete(id: ConversationId): Promise<void> {
        // A deleted session cannot be seen or stopped, so a run left in it would go on working unseen.
        await (await this.#harness.conversation(id, this.#context))?.abort(this.#context);
        await this.#harness.commit(async (tx) => {
            (await tx.doc(DeletedDoc, id)).deleted = true;
        }, this.#context);
        this.#open.delete(id);
        this.#questions.delete(id);
    }

    /** Names the session by hand; an empty name goes back to the automatic one. */
    async setTitle(id: ConversationId, title: string): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(TitleDoc, id)).title = title;
        }, this.#context);
    }

    /** The conversation with its state attached, opened once and then kept. */
    async open(id: ConversationId): Promise<Opened | undefined> {
        const known = this.#open.get(id);

        if (known !== undefined) {
            return known;
        }

        if (await this.#isDeleted(id)) {
            return undefined;
        }

        const conversation = await this.#harness.conversation(id, this.#context);

        if (conversation === undefined) {
            return undefined;
        }

        const opened: Opened = { id, conversation, sent: [], watched: false };

        this.#open.set(id, opened);

        return opened;
    }

    /** The id of every conversation that was not deleted, read page by page. Nothing else about them is loaded. */
    async ids(): Promise<ConversationId[]> {
        const ids: ConversationId[] = [];
        let cursor: Cursor | undefined;

        do {
            const next: Cursor | undefined = cursor;
            const page = await this.#harness.commit(
                (tx) => tx.scanConversations({}, 100, next),
                this.#context,
            );

            for (const { id } of page.items) {
                if (!(await this.#isDeleted(id))) {
                    ids.push(id);
                }
            }

            cursor = page.next;
        } while (cursor !== undefined);

        return ids;
    }

    async list(busy: (id: ConversationId) => boolean): Promise<SessionSummary[]> {
        const summaries: SessionSummary[] = [];
        let cursor: Cursor | undefined;

        do {
            const next: Cursor | undefined = cursor;
            const page = await this.#harness.commit(
                (tx) => tx.scanConversations({}, 100, next),
                this.#context,
            );

            for (const { id } of page.items) {
                const row = await this.#row(id, busy(id));

                if (row !== undefined) {
                    summaries.push(row);
                }
            }

            cursor = page.next;
        } while (cursor !== undefined);

        return summaries;
    }

    /**
     * One row, from one commit: the harness runs one commit or read at a time, so a row that asked for its
     * documents, record, agent and question one at a time would hold that line six times.
     */
    async #row(id: ConversationId, working: boolean): Promise<SessionSummary | undefined> {
        const remembered = this.#questions.get(id);
        const read = await this.#harness.commit(async (tx) => {
            if ((await tx.doc(DeletedDoc, id)).deleted) {
                return undefined;
            }

            const record = await tx.conversation(id);

            if (record === undefined) {
                return undefined;
            }

            // The three fields a row shows from `pi.agent`, as `resolveAgent()` derives them: resolving the
            // whole agent would compose its tools and sections for every conversation in the list.
            const agent = await tx.doc(AgentDoc, id);
            const chosen = (await tx.doc(TitleDoc, id)).title;
            const attention = await tx.doc(AttentionDoc, id);
            const archived = (await tx.doc(ArchiveDoc, id)).archived;
            const clock = await tx.doc(ClockDoc, id);
            const activeAt = clock.activeAt > 0 ? clock.activeAt : await stamped(tx, id);

            return {
                name: chosen === "" ? null : oneLine(chosen),
                asked: chosen === "" ? (remembered ?? (await firstQuestion(tx, id))) : null,
                cwd: agent.cwd ?? null,
                model:
                    agent.model === undefined
                        ? null
                        : `${agent.model.provider}/${agent.model.modelId}`,
                thinkingLevel: agent.thinkingLevel ?? "off",
                archived,
                endedAt: attention.endedAt,
                seenAt: attention.seenAt,
                activeAt,
                owner: record.owner?.conversationId,
            };
        }, this.#context);

        if (read === undefined) {
            return undefined;
        }

        if (read.asked !== null) {
            this.#questions.set(id, read.asked);
        }

        return {
            id,
            name: read.name,
            title: read.name ?? read.asked,
            cwd: read.cwd,
            model: read.model,
            thinkingLevel: read.thinkingLevel,
            busy: working,
            archived: read.archived,
            activeAt: read.activeAt,
            unseen: !working && !read.archived && read.endedAt > read.seenAt,
            ...(read.endedAt > 0 ? { endedAt: read.endedAt } : {}),
            ...(read.owner === undefined ? {} : { parent: Number(read.owner) }),
        };
    }

    /** The conversation that started this one, from the immutable record; undefined for a session a person created. */
    async owner(id: ConversationId): Promise<number | undefined> {
        const record = await this.#harness.commit((tx) => tx.conversation(id), this.#context);

        return record?.owner === undefined ? undefined : Number(record.owner.conversationId);
    }

    /**
     * The current value of a conversation document, or its initial value while the conversation has
     * none. It only reads: no document is created and no revision moves.
     */
    async readDoc<T extends JsonObject>(
        doc: ConversationDocToken<T>,
        id: ConversationId,
    ): Promise<Readonly<T>> {
        return (await this.#harness.snapshot(doc, id, this.#context)) ?? doc.definition.initial();
    }

    /** A deleted session is out of the lists for good; its rows stay in storage. */
    async #isDeleted(id: ConversationId): Promise<boolean> {
        return this.#harness.commit(
            async (tx) => (await tx.doc(DeletedDoc, id)).deleted,
            this.#context,
        );
    }

    /** The name the sidebar shows: the one set by hand, else the first question. None for a deleted session, which no list shows. */
    async title(id: ConversationId): Promise<string | null> {
        if (await this.#isDeleted(id)) {
            return null;
        }

        return (await this.name(id)) ?? (await this.#question(id));
    }

    /** The name set by hand or by an extension, or null while the first question still names the session. */
    async name(id: ConversationId): Promise<string | null> {
        const chosen = await this.#harness.commit(
            async (tx) => (await tx.doc(TitleDoc, id)).title,
            this.#context,
        );

        return chosen === "" ? null : oneLine(chosen);
    }

    /** The first question, read from the log only until it is found. */
    async #question(id: ConversationId): Promise<string | null> {
        const remembered = this.#questions.get(id);

        if (remembered !== undefined) {
            return remembered;
        }

        const asked = await this.#harness.commit((tx) => firstQuestion(tx, id), this.#context);

        if (asked !== null) {
            this.#questions.set(id, asked);
        }

        return asked;
    }
}
