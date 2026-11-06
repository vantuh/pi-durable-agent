/**
 * The session list stream: the whole list to a tab that connects, then the rows that changed. Changes are
 * collected into one frame per burst, and the whole list is read again now and then in case a path forgot to
 * name its session.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import type { ExtensionNotice, SessionSummary } from "../../shared/protocol.ts";
import { idOf } from "../conversation-id.ts";
import type { Extensions } from "../extensions/extensions.ts";
import { openEventStream } from "../http.ts";
import { SessionList } from "../session-list.ts";
import type { Sessions } from "../sessions.ts";
import { type EventStream, sendFrame, sendHeartbeat } from "./event-stream.ts";

/** A burst of changes (a run ending writes several) is sent as one frame. */
const LIST_DELAY_MS = 100;
/**
 * A row whose change nobody marked would stay stale for ever. Every so often the whole list is read again and
 * diffed, so a path that forgets to name its session costs a delay, not a wrong row.
 */
const RECONCILE_MS = 30_000;

export type SessionsStream = {
    /** Records that a session's row changed (or, with no id, that any may have) and sends it once per burst. */
    changed: (id?: number) => void;
    /** The rows the browser reads, marked by the extensions. */
    rows: () => Promise<SessionSummary[]>;
    /** The session list stream of one tab. */
    watch: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
    /** An extension's notice about a session, to every tab: the list stream is the one all of them hold. */
    notice: (notice: ExtensionNotice) => void;
    heartbeat: () => void;
    dispose: () => void;
};

/**
 * `sessions` and `extensions` are read when a frame is made, not when the stream is built: the extensions' host
 * calls back into this stream, and the sessions open after the extensions load.
 */
export function sessionsStream(deps: {
    sessions: () => Sessions;
    extensions: () => Pick<Extensions, "markOf" | "groupOf">;
    isBusy: (id: number) => boolean;
}): SessionsStream {
    const { isBusy } = deps;
    const watchers = new Set<EventStream>();
    let queued = false;
    let chain: Promise<void> = Promise.resolve();
    let reconcile: ReturnType<typeof setInterval> | undefined;

    /** What extensions say about a session's row: the mark they put on it and the folder it is shown under. */
    async function markRow(row: SessionSummary): Promise<SessionSummary> {
        const extensions = deps.extensions();
        const mark = extensions.markOf(row.id);
        const under = row.cwd === null ? undefined : await extensions.groupOf(row.cwd);

        return {
            ...row,
            ...(mark === undefined ? {} : { mark }),
            ...(under === undefined ? {} : { under }),
        };
    }

    async function rows(): Promise<SessionSummary[]> {
        return Promise.all((await deps.sessions().list(isBusy)).map(markRow));
    }

    /** One row, as the browser reads it: what a change that names its session costs, instead of the whole list. */
    async function markedRow(id: number): Promise<SessionSummary | undefined> {
        const row = await deps.sessions().row(idOf(id), isBusy(id));

        return row === undefined ? undefined : markRow(row);
    }

    const list = new SessionList({ rows, row: markedRow });

    /**
     * One send after another: a watcher's whole list always comes before any frame of changes it would lack, and an
     * older frame never lands after a newer one.
     */
    function queueSend(task: () => Promise<void>): Promise<void> {
        const sent = chain.then(task);

        chain = sent.catch((error: unknown) => {
            console.error(error);
        });

        return chain;
    }

    async function flush(): Promise<void> {
        await delay(LIST_DELAY_MS);
        queued = false;

        const frame = await list.flush();

        if (frame !== undefined) {
            sendFrame(watchers, { type: "rows", rows: frame.rows, gone: frame.gone });
        }
    }

    /**
     * Sends what changed to every list stream, once per burst. An id names the session the change touched, so only
     * its row is read again; a change that names none, and the periodic reconcile, read the whole list.
     */
    function changed(id?: number): void {
        if (watchers.size === 0) {
            return;
        }

        list.changed(id);

        if (queued) {
            return;
        }

        queued = true;
        void queueSend(flush);
    }

    /** Read again only while someone is watching: the list nobody reads needs no reconciling. */
    function watchReconcile(): void {
        reconcile ??= setInterval(() => {
            changed();
        }, RECONCILE_MS);
    }

    function unwatchReconcile(): void {
        if (watchers.size > 0 || reconcile === undefined) {
            return;
        }

        clearInterval(reconcile);
        reconcile = undefined;
    }

    return {
        changed,
        rows,
        watch: async (request, response) => {
            const watcher: EventStream = { response, gzip: openEventStream(request, response) };

            response.on("close", () => {
                watchers.delete(watcher);
                unwatchReconcile();
            });
            // Queued like every flush, so no frame of changes this watcher lacks can be diffed before the list it starts from.
            await queueSend(async () => {
                watchers.add(watcher);
                watchReconcile();
                sendFrame([watcher], { type: "sessions", sessions: await list.whole() });
            });
        },
        notice: (notice) => {
            sendFrame(watchers, { type: "extension-notice", notice });
        },
        heartbeat: () => {
            sendHeartbeat(watchers);
        },
        dispose: () => {
            if (reconcile !== undefined) {
                clearInterval(reconcile);
                reconcile = undefined;
            }
        },
    };
}
