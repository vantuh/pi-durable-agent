/**
 * Subagents, after Pi Durable's example 23: each agent is its own conversation, owned by a background
 * anchor task, so the parent's Stop never reaches it and the parent is not kept busy by it. Every
 * message to an agent is a background reporter task that submits it, waits for the answer, and posts
 * the answer back to the parent as input. Request IDs keep a restart from sending either twice.
 */

import { defineExtension } from "@earendil-works/pi-durable";

import type { CommitView, Host } from "../../server/sdk.ts";
import { promptParts } from "./server/prompt.ts";
import { seen } from "./server/strip.ts";
import { Anchor, Reporter } from "./server/tasks.ts";
import { agentTools } from "./server/tools.ts";

export const meta = {
    title: "Subagents",
    description:
        "agent_spawn, agent_send, agent_stop and agent_status: hand work to agents from ~/.pi/agent/agents.",
    toggle: true,
};

export { actions } from "./server/actions.ts";

export default function subagents(host: Host) {
    host.onDispose(() => {
        seen.clear();
    });
    host.onCommit((view: CommitView) => {
        const { id, owner, cwd } = view.session;

        if (owner === undefined) {
            return;
        }

        const answer = view.entries.findLast((entry) => entry.kind === "pi.assistant")?.model?.[0];

        // The strip shows working agents only, so an idle one is not kept.
        if (view.busy) {
            seen.set(id, {
                owner,
                cwd,
                answer: answer?.role === "assistant" ? answer : undefined,
            });
        } else {
            seen.delete(id);
        }
        host.notifySessionChanged(owner);
    });

    const { sections, wraps } = promptParts(host);

    return defineExtension({
        name: host.name,
        tasks: [Anchor, Reporter],
        tools: agentTools(host),
        sections,
        wraps,
    });
}
