/**
 * The rows the session list stream sends: the whole list to a watcher that holds none, then only what changed.
 * Every watcher holds the same list, so one diff serves them all, and a row is compared as the browser would
 * hold it — `JSON.stringify` — so nothing here has to know which field moved.
 */

import type { SessionSummary } from "../shared/protocol.ts";

/** One frame's worth: the rows that differ from what the watchers hold, and the ids that are gone. */
export type ListFrame = { rows: SessionSummary[]; gone: number[] };

export class SessionList {
    readonly #read: () => Promise<SessionSummary[]>;
    /** What the watchers hold, as the last frame left it. */
    readonly #held = new Map<number, SessionSummary>();

    constructor(read: () => Promise<SessionSummary[]>) {
        this.#read = read;
    }

    /** The whole list, for a watcher that holds none; from now on it is what every watcher holds. */
    async whole(): Promise<SessionSummary[]> {
        const rows = await this.#read();

        this.#hold(rows);

        return rows;
    }

    /** The frame for everything that changed since `whole()` or the last flush; undefined when nothing did. */
    async flush(): Promise<ListFrame | undefined> {
        const rows = await this.#read();
        const present = new Set(rows.map((row) => row.id));
        const frame: ListFrame = {
            rows: rows.filter(
                (row) => JSON.stringify(this.#held.get(row.id)) !== JSON.stringify(row),
            ),
            gone: [...this.#held.keys()].filter((id) => !present.has(id)),
        };

        this.#hold(rows);

        return frame.rows.length === 0 && frame.gone.length === 0 ? undefined : frame;
    }

    #hold(rows: SessionSummary[]): void {
        this.#held.clear();

        for (const row of rows) {
            this.#held.set(row.id, row);
        }
    }
}
