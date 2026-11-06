import { type ConversationId, defineDoc, type EntryId } from "@earendil-works/pi-durable";

export type AgentRecord = {
    conversationId: ConversationId;
    /** The profile it runs with. */
    agent: string;
    /** The last tool call that sent it work, so a replayed call sends nothing twice. */
    callId: string;
    /** Answers already reported, so a steered message and the run it joined report once. */
    reported: EntryId[];
    /** Set by agent_stop: the aborted run reports nothing, as the parent asked for it. */
    stopped: boolean;
    /** How many times agent_stop ran; a Reporter made before the latest stop must not deliver. */
    stops?: number;
};

/** The agents a conversation started, by name. */
export const AgentsDoc = defineDoc({
    kind: "subagents.agents",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: (): { agents: Record<string, AgentRecord> } => ({ agents: {} }),
    checkpointWhen: () => true,
});

/**
 * How an agent's prompt differs from its parent's, from its profile; only agents have one. `rules`
 * false drops the rules section, `skills` lists only those skills (null: every skill).
 */
export const ChildDoc = defineDoc({
    kind: "subagents.child",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: (): { rules: boolean; skills: string[] | null } => ({ rules: true, skills: null }),
    checkpointWhen: () => true,
});
