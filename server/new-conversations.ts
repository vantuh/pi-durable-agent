import type { Harness } from "@earendil-works/pi-durable";

/**
 * Calls `observe` with the id of every conversation created from now on, whoever creates it. Work
 * that a task starts (an agent's conversation) is born inside a commit, and nothing else would
 * ever open it; so its commits would reach no browser and no extension until someone visited it.
 * Returns the way to stop.
 */
export function observeNewConversations(
    harness: Pick<Harness, "subscribeCommits">,
    observe: (id: number) => void,
): () => void {
    return harness.subscribeCommits((publication) => {
        for (const change of publication.changes) {
            if (change.type === "conversation") {
                const id = Number(change.value.id);

                // The listener must not call the Session, which `observe` does.
                setImmediate(() => {
                    observe(id);
                });
            }
        }
    });
}
