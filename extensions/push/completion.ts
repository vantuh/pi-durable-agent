/** The part of a commit that matters here; a `CommitView` fits it. */
export type CommitSlice = {
    readonly session: { readonly id: number };
    readonly entries: readonly {
        readonly id: number;
        readonly kind: string;
        readonly model?: readonly unknown[];
    }[];
    readonly busy: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Finds the end of a turn in the commits of a conversation. A conversation has a settled point: the
 * last entry whose turn is fully accounted for. Each commit is read from there, so the same commit
 * gives the same answer however often it arrives (a replay after a reload, a second commit).
 *
 * A turn ends when its answer stops for its own reason (not a tool call, an error or an abort) and
 * the run is idle, or a queued message starts the next turn. A conversation seen for the first
 * time, with no remembered settled point, only sets its baseline: old history never notifies.
 */
export class Completions {
    readonly #settled = new Map<number, number>();

    /**
     * `persisted` is the settled point saved for the conversation, shared by every version of the
     * extension; it wins over what this instance remembers. Without either, this commit is the baseline.
     */
    observe(view: CommitSlice, persisted?: number): { done: number; settled: number } {
        const top = Math.max(0, ...view.entries.map((entry) => entry.id));
        const before = persisted ?? this.#settled.get(view.session.id);

        if (before === undefined) {
            this.#settled.set(view.session.id, top);

            return { done: 0, settled: top };
        }

        let done = 0;
        let pending = false;
        let settled = Math.min(before, top);

        for (const entry of view.entries) {
            if (entry.id <= settled) {
                continue;
            }

            if (entry.kind === "pi.user") {
                done += pending ? 1 : 0;
                pending = false;
            } else if (entry.kind === "pi.assistant") {
                const message = Array.isArray(entry.model) ? entry.model[0] : undefined;

                pending = isRecord(message) && message["stopReason"] === "stop";
            }

            if (!pending) {
                settled = entry.id;
            }
        }

        if (pending && !view.busy) {
            done += 1;
            settled = top;
        }

        this.#settled.set(view.session.id, settled);

        return { done, settled };
    }
}
