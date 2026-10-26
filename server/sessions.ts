/**
 * Conversations as the browser sees them: a list, a folder each, an agent each. The harness owns the
 * conversations; this file only opens them, names them after their first question, and remembers which
 * folder each one works in.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Context } from "@earendil-works/chord/context";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";

import { projectEntry } from "./projection.ts";

const run = promisify(execFile);
const BRANCH_TTL_MS = 10_000;

export type SessionSummary = {
    id: ConversationId;
    title: string | null;
    cwd: string | null;
    model: string | null;
    thinkingLevel: string | null;
    branch: string | null;
    busy: boolean;
};

export type Opened = {
    id: ConversationId;
    conversation: Conversation;
    sent: number[];
    watched: boolean;
};

type Branch = { name: string | null; at: number };

export class Sessions {
    readonly #harness: Harness;
    readonly #model: { provider: string; modelId: string };
    readonly #cwd: string;
    readonly #context: Context;
    readonly #branches = new Map<string, Branch>();
    readonly #open = new Map<ConversationId, Opened>();

    constructor(options: {
        harness: Harness;
        model: { provider: string; modelId: string };
        cwd: string;
        context: Context;
    }) {
        this.#harness = options.harness;
        this.#model = options.model;
        this.#cwd = options.cwd;
        this.#context = options.context;
    }

    /** The reserved root conversation: the one this app started with. */
    async root(): Promise<Conversation> {
        return this.#harness.root(this.#context, { agent: { model: this.#model, cwd: this.#cwd } });
    }

    async create(cwd: string): Promise<Conversation> {
        return this.#harness.createConversation(
            { ownership: { kind: "ownerless" }, agent: { model: this.#model, cwd } },
            this.#context,
        );
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

    async list(busy: (id: ConversationId) => boolean): Promise<SessionSummary[]> {
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

            summaries.push({
                id: record.id,
                title: await this.#title(record.id),
                cwd,
                model:
                    agent.model === undefined
                        ? null
                        : `${agent.model.provider}/${agent.model.modelId}`,
                thinkingLevel: agent.thinkingLevel,
                branch: cwd === null ? null : await this.branchOf(cwd),
                busy: busy(record.id),
            });
        }

        return summaries;
    }

    async branchOf(cwd: string): Promise<string | null> {
        const cached = this.#branches.get(cwd);

        if (cached !== undefined && Date.now() - cached.at < BRANCH_TTL_MS) {
            return cached.name;
        }

        let name: string | null = null;

        try {
            const { stdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });

            name = stdout.trim() === "" ? null : stdout.trim();
        } catch {
            name = null;
        }

        this.#branches.set(cwd, { name, at: Date.now() });

        return name;
    }

    /** A session is named after what it was first asked, until titles are documents of their own. */
    async #title(id: ConversationId): Promise<string | null> {
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
