import type { ConversationView } from "@earendil-works/pi-durable";

import type { CommitView } from "./extensions.ts";

/**
 * A commit as extensions see it: the folder its tools run in, from the agent document, and the
 * conversation that started it, from the immutable record. Both are in the commit's own view, so this
 * is read as it was at that commit: a later one cannot rewrite it.
 */
export function commitView(view: ConversationView, busy: boolean): CommitView {
    const owner = view.conversation.owner?.conversationId;
    const cwd = view.docs["pi.agent"]?.["cwd"];

    return {
        session: {
            id: Number(view.conversation.id),
            cwd: typeof cwd === "string" ? cwd : null,
            ...(owner === undefined ? {} : { owner: Number(owner) }),
        },
        entries: view.entries,
        busy,
    };
}
