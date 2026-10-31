/**
 * The rows the session list stream sends: the whole list to a watcher that holds none, then only what changed.
 * Every watcher holds the same list, so one diff serves them all, and a row is compared as the browser would
 * hold it — `JSON.stringify` — so nothing here has to know which field moved.
 */

import type { SessionSummary } from "../shared/protocol.ts";

/** One frame's worth: the rows that differ from what the watchers hold, and the ids that are gone. */
export type ListFrame = { rows: SessionSummary[]; gone: number[] };

export type ListReaders = {
    /** Every row, in one commit each: what a change that names no session costs, and what the reconcile pays. */
    rows: () => Promise<SessionSummary[]>;
    /** One row, or undefined for a session that is deleted or whose owner chain is. */
    row: (id: number) => Promise<SessionSummary | undefined>;
};

export class SessionList {
    readonly #readers: ListReaders;
    /** What the watchers hold, as the last frame left it. */
    readonly #held = new Map<number, SessionSummary>();
    /** The sessions whose row a change touched. */
    readonly #dirty = new Set<number>();
    /** Something changed that names no session: every row has to be read again. */
    #whole = false;

    constructor(readers: ListReaders) {
        this.#readers = readers;
    }

    /** Records that one session's row may have changed, or — with no id — that the whole list must be read. */
    changed(id?: number): void {
        if (id === undefined) {
            this.#whole = true;
        } else {
            this.#dirty.add(id);
        }
    }

    /** The whole list, for a watcher that holds none; from now on it is what every watcher holds. */
    async whole(): Promise<SessionSummary[]> {
        const rows = await this.#readers.rows();

        this.#held.clear();

        for (const row of rows) {
            this.#held.set(row.id, row);
        }

        return rows;
    }

    /** The frame for what changed since `whole()` or the last flush; undefined when nothing did. */
    async flush(): Promise<ListFrame | undefined> {
        const whole = this.#whole;
        const dirty = [...this.#dirty];

        this.#whole = false;
        this.#dirty.clear();

        return whole ? await this.#flushWhole() : await this.#flushRows(dirty);
    }

    async #flushWhole(): Promise<ListFrame | undefined> {
        const rows = await this.#readers.rows();
        const frame: ListFrame = { rows: [], gone: [] };
        const present = new Set<number>();

        for (const row of rows) {
            present.add(row.id);
            this.#keep(row, frame);
        }

        for (const id of [...this.#held.keys()]) {
            if (!present.has(id)) {
                this.#drop(id, frame);
            }
        }

        return frame.rows.length === 0 && frame.gone.length === 0 ? undefined : frame;
    }

    /** Reads only the sessions a change named: a row that moves must not cost every other row of the list. */
    async #flushRows(ids: readonly number[]): Promise<ListFrame | undefined> {
        const frame: ListFrame = { rows: [], gone: [] };

        for (const id of ids) {
            const row = await this.#readers.row(id);

            if (row === undefined) {
                this.#drop(id, frame);
            } else {
                this.#keep(row, frame);
            }
        }

        return frame.rows.length === 0 && frame.gone.length === 0 ? undefined : frame;
    }

    /** A row that differs from the one held is sent; an equal one is not, and both become what is held. */
    #keep(row: SessionSummary, frame: ListFrame): void {
        if (JSON.stringify(this.#held.get(row.id)) !== JSON.stringify(row)) {
            frame.rows.push(row);
        }

        this.#held.set(row.id, row);
    }

    /** A session no list carries is dropped from what is held, and said once: a client may never have had it. */
    #drop(id: number, frame: ListFrame): void {
        if (this.#held.delete(id)) {
            frame.gone.push(id);
        }
    }
}
