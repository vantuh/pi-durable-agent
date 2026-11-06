import type { Harness } from "@earendil-works/pi-durable";

/**
 * Calls `observe` with the id of every conversation created from now on, whoever creates it. Work
 * that a task starts (an agent's conversation) is born inside a commit, and nothing else would
 * ever open it; so its commits would reach no browser and no extension until someone visited it.
 * Returns the way to stop.
 */
export function observeNewConversations(
    harness: Pick<Harness, "observeCommits">,
    observe: (id: number) => void,
): () => void {
    const observation = harness.observeCommits({
        advance: (publication) => {
            for (const change of publication.changes) {
                if (change.type === "conversation") {
                    const id = Number(change.value.id);

                    // The observer must not call the Session, which `observe` does.
                    setImmediate(() => {
                        observe(id);
                    });
                }
            }
        },
        // The Session closing with the harness is the only end, and the caller has stopped by then.
        end: () => {},
    });

    return () => {
        observation.detach();
    };
}
