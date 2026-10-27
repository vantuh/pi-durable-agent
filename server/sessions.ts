/**
 * Conversations as the browser sees them: a list, a folder each, an agent each. The harness owns the
 * conversations; this file only opens them, names them after their first question, and remembers which
 * folder each one works in.
 */

import type { Context } from "@earendil-works/chord/context";
import {
    type Conversation,
    type ConversationId,
    type Cursor,
    defineDoc,
    type Harness,
} from "@earendil-works/pi-durable";

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

export type SessionSummary = {
    id: ConversationId;
    title: string | null;
    cwd: string | null;
    model: string | null;
    thinkingLevel: string | null;
    busy: boolean;
    archived: boolean;
    activeAt: number | null;
    endedAt?: number;
};

export type Opened = {
    id: ConversationId;
    conversation: Conversation;
    sent: number[];
    watched: boolean;
};

export class Sessions {
    readonly #harness: Harness;
    readonly #model: { provider: string; modelId: string };
    readonly #context: Context;
    readonly #open = new Map<ConversationId, Opened>();

    constructor(options: {
        harness: Harness;
        model: { provider: string; modelId: string };
        context: Context;
    }) {
        this.#harness = options.harness;
        this.#model = options.model;
        this.#context = options.context;
    }

    async create(cwd: string): Promise<Conversation> {
        const chosen = await this.defaults();
        const conversation = await this.#harness.createConversation(
            {
                ownership: { kind: "ownerless" },
                agent: {
                    model: chosen === undefined ? this.#model : chosen.model,
                    cwd,
                    ...(chosen === undefined ? {} : { thinkingLevel: chosen.thinkingLevel }),
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

    async setArchived(id: ConversationId, archived: boolean): Promise<void> {
        await this.#harness.commit(async (tx) => {
            (await tx.doc(ArchiveDoc, id)).archived = archived;
        }, this.#context);
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

        const conversation = await this.#harness.conversation(id, this.#context);

        if (conversation === undefined) {
            return undefined;
        }

        const opened: Opened = { id, conversation, sent: [], watched: false };

        this.#open.set(id, opened);

        return opened;
    }

    /** The id of every conversation, read page by page. Nothing else about them is loaded. */
    async ids(): Promise<ConversationId[]> {
        const ids: ConversationId[] = [];
        let cursor: Cursor | undefined;

        do {
            const next: Cursor | undefined = cursor;
            const page = await this.#harness.commit(
                (tx) => tx.scanConversations({}, 100, next),
                this.#context,
            );

            ids.push(...page.items.map((record) => record.id));
            cursor = page.next;
        } while (cursor !== undefined);

        return ids;
    }

    async list(
        busy: (id: ConversationId) => boolean,
        endedAt: (id: ConversationId) => number | undefined = () => undefined,
    ): Promise<SessionSummary[]> {
        const page = await this.#harness.commit(
            (tx) => tx.scanConversations({}, 100),
            this.#context,
        );
        const summaries: SessionSummary[] = [];

        for (const record of page.items) {
            const conversation = await this.#harness.conversation(record.id, this.#context);

            if (conversation === undefined) {
                continue;
            }

            const agent = await conversation.agent(this.#context);
            const cwd = agent.cwd ?? null;

            const ended = endedAt(record.id);

            summaries.push({
                id: record.id,
                title: await this.#title(record.id),
                cwd,
                model:
                    agent.model === undefined
                        ? null
                        : `${agent.model.provider}/${agent.model.modelId}`,
                thinkingLevel: agent.thinkingLevel,
                busy: busy(record.id),
                archived: await this.#harness.commit(
                    async (tx) => (await tx.doc(ArchiveDoc, record.id)).archived,
                    this.#context,
                ),
                activeAt: await this.#activeAt(record.id),
                ...(ended === undefined ? {} : { endedAt: ended }),
            });
        }

        return summaries;
    }

    /**
     * The stored time, or, for a session older than the clock, the start time of its newest message,
     * which the model message carries. A session with neither has no time.
     */
    async #activeAt(id: ConversationId): Promise<number | null> {
        const stored = await this.#harness.commit(
            async (tx) => (await tx.doc(ClockDoc, id)).activeAt,
            this.#context,
        );

        if (stored > 0) {
            return stored;
        }

        const page = await this.#harness.commit(
            (tx) => tx.scanEntries({ conversationId: id, order: "descending" }, 1),
            this.#context,
        );
        const stamp = page.items[0]?.model?.[0]?.timestamp;

        if (stamp === undefined) {
            return null;
        }

        await this.#harness.commit(async (tx) => {
            (await tx.doc(ClockDoc, id)).activeAt = stamp;
        }, this.#context);

        return stamp;
    }

    /** A session is named after what it was first asked, until titles are documents of their own. */
    async #title(id: ConversationId): Promise<string | null> {
        const chosen = await this.#harness.commit(
            async (tx) => (await tx.doc(TitleDoc, id)).title,
            this.#context,
        );

        if (chosen !== "") {
            return chosen;
        }

        const page = await this.#harness.commit(
            (tx) => tx.scanEntries({ conversationId: id, order: "ascending" }, 5),
            this.#context,
        );

        for (const record of page.items) {
            const entry = projectEntry(record);

            if (entry?.kind === "user" && entry.text.trim() !== "") {
                return entry.text.trim().slice(0, 80);
            }
        }

        return null;
    }
}
