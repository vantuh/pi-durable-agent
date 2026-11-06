/**
 * The conversation stream: one `hello` for a browser that connects to a session, then every change of that session.
 * The server holds, per session, the last state it saw and the newest entry it sent; per browser, what that
 * browser already holds of the live answer, so each frame carries only what it lacks.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { ConversationView } from "@earendil-works/pi-durable";

import type {
    ClientBlock,
    ClientEntry,
    ClientLive,
    ClientQueued,
    ClientStatus,
    ExtensionNotice,
    ServerEvent,
} from "../../shared/protocol.ts";
import { commitView } from "../commit-view.ts";
import { idOf } from "../conversation-id.ts";
import type { Extensions } from "../extensions/extensions.ts";
import { openEventStream } from "../http.ts";
import { blocksSince, listSince } from "../live-delta.ts";
import { liveWindow } from "../live-window.ts";
import { projectEntry, projectLive } from "../projection.ts";
import { sessionChanges } from "../session-changes.ts";
import type { Opened, Sessions } from "../sessions.ts";
import { type EventStream, sendFrame, sendHeartbeat } from "./event-stream.ts";
import { helloPage } from "./hello.ts";

type View = ConversationView;

/** A child that commits all the time makes its parent's browsers ask again once per this long. */
const CHANGE_WINDOW_MS = 250;
/**
 * A commit lands about every 100 ms while an answer streams, and each one used to send a whole frame to every
 * browser. One frame per window is four a second, the same window `CHANGE_WINDOW_MS` gives extension-notified
 * changes, so both sources of a live frame behave alike.
 */
const LIVE_FRAME_MS = 250;

type Client = EventStream & {
    session: number;
    /** The blocks of the streamed answer this client holds, so a live frame carries only what it lacks. */
    held: ClientBlock[];
    /** The waiting messages this client holds: a live frame repeats them only when they changed. */
    heldQueued: ClientQueued[];
    /** The extension status fields this client holds, for the same reason. */
    heldStatus: ClientStatus[];
};

export type ConversationStream = {
    /** Opens a conversation and starts forwarding its commits. A caller that comes while it opens gets the same open. */
    attach: (id: number) => Promise<Opened | undefined>;
    /** Drops everything the server holds for a session that is gone. */
    detach: (id: number) => void;
    /** Starts the event stream of one browser on a session. */
    stream: (request: IncomingMessage, response: ServerResponse, opened: Opened) => void;
    isBusy: (id: number) => boolean;
    /** Whether the session's own run is busy, or a session started from it, at any depth, is. */
    working: (session: number) => Promise<boolean>;
    /** Sends every session's newest state again: an extension was loaded or removed, and the status fields moved. */
    republish: () => void;
    /** An extension's notice, to every browser on a conversation stream, under the session each one shows. */
    notice: (notice: ExtensionNotice) => void;
    /** Something about a session changed that its commits do not show: its browsers hear within a window. */
    changed: (session: number) => void;
    heartbeat: () => void;
    dispose: () => void;
};

/**
 * `sessions` and `extensions` are read when a frame is made, not when the stream is built: the extensions' host
 * calls back into this stream, and the sessions open after the extensions load.
 */
export function conversationStream(deps: {
    sessions: () => Sessions;
    extensions: () => Pick<Extensions, "statuses" | "publish" | "forget">;
    /** The context window of a model in the catalog, in tokens. */
    contextWindow: (provider: string, modelId: string) => number | undefined;
    /** The session list has to be read again, for one session or, with no id, for all. */
    listChanged: (id?: number) => void;
    /** The model the `hello` names, as `provider/modelId`. */
    model: string;
}): ConversationStream {
    const { sessions, extensions, contextWindow, listChanged, model } = deps;
    const clients = new Set<Client>();
    const busy = new Map<number, boolean>();
    const latest = new Map<number, { opened: Opened; view: View }>();
    const liveFrames = liveWindow({
        windowMs: LIVE_FRAME_MS,
        send: sendLive,
    });
    const changes = sessionChanges({
        windowMs: CHANGE_WINDOW_MS,
        changed: (id) => {
            liveFrames.changed(id);
        },
    });

    function send(client: Client, event: ServerEvent): void {
        sendFrame([client], event);
    }

    function broadcast(event: ServerEvent): void {
        for (const client of clients) {
            if (client.session === event.session) {
                send(client, event);
            }
        }
    }

    function isBusy(id: number): boolean {
        return busy.get(id) === true;
    }

    /** Whether the session's own run is busy, or a session started from it, at any depth, is. */
    async function sessionWorking(session: number): Promise<boolean> {
        if (isBusy(session)) {
            return true;
        }

        for (const [id, running] of busy) {
            let owner = running ? await sessions().owner(idOf(id)) : undefined;
            // Stops a cycle in the records from looping.
            const visited = new Set([id]);

            while (owner !== undefined && !visited.has(owner)) {
                if (owner === session) {
                    return true;
                }

                visited.add(owner);
                owner = await sessions().owner(idOf(owner));
            }
        }

        return false;
    }

    function entriesOf(view: View): ClientEntry[] {
        return view.entries.map(projectEntry);
    }

    /** The state `publish` last stored for a session; `attach` stores one before it returns the open. */
    function viewOf(id: number): View {
        const current = latest.get(id);

        if (current === undefined) {
            throw new Error(`session ${String(id)} is not attached`);
        }

        return current.view;
    }

    function liveOf(id: number, view: View): ClientLive {
        const live = projectLive(
            view.docs["pi.live"],
            view.docs["pi.usage"],
            view.docs["pi.inbox"],
        );
        const status = extensions().statuses({
            entries: view.entries,
            contextWindow,
        });
        const revision = changes.revision(id);

        return {
            ...live,
            ...(status.length === 0 ? {} : { status }),
            ...(revision === 0 ? {} : { revision }),
        };
    }

    /** The newest live state to every client of a session, each frame cut to what that client does not hold yet. */
    function sendLive(id: number): void {
        const current = latest.get(id);

        if (current === undefined) {
            return;
        }

        const live = liveOf(id, current.view);

        for (const client of clients) {
            if (client.session === id) {
                const { blocks, queued, status, ...rest } = live;
                const changed = listSince(client.heldQueued, queued);
                const changedStatus = listSince(client.heldStatus, status);

                send(client, {
                    type: "live",
                    session: id,
                    live: {
                        ...rest,
                        ...(blocks === undefined
                            ? {}
                            : { blocks: blocksSince(client.held, blocks) }),
                        ...(changed === undefined ? {} : { queued: changed }),
                        ...(changedStatus === undefined ? {} : { status: changedStatus }),
                    },
                });
                client.held = blocks ?? [];
                client.heldQueued = queued ?? [];
                client.heldStatus = status ?? [];
            }
        }
    }

    /**
     * Sends what changed since the last commit: the entries above the newest one already sent. The view is a window
     * that drops its oldest entries when it grows past its maximum, and ids only grow, so the entries a browser holds
     * are never sent again and never replaced.
     */
    function publish(opened: Opened, view: View): void {
        const live = liveOf(opened.id, view);
        const entries = entriesOf(view);
        const fresh = entries.filter((entry) => entry.id > opened.newestSent);
        // The one entry a row shows: the question that names the session, which only a window that starts the
        // transcript can hold. A row's time is when its newest run started, which is not an entry: the entries a run
        // appends change nothing in the list.
        const asked =
            view.before === undefined
                ? entries.find((entry) => entry.kind === "user" && entry.text.trim() !== "")
                : undefined;
        const named = asked !== undefined && asked.id > opened.newestSent;
        const unchanged = fresh.length === 0;

        if (!unchanged) {
            opened.newestSent = Math.max(...fresh.map((entry) => entry.id));
            broadcast({ type: "entries", session: opened.id, entries: fresh });
        }

        // A run starting or ending moves the row's mark and its unseen state; a first question names it.
        if (named || isBusy(opened.id) !== live.busy) {
            listChanged(opened.id);
        }

        latest.set(opened.id, { opened, view });
        // A run's start is the row's time, whoever started it: a person's message touches the clock in its own
        // request, and a subagent, a report or a queued follow-up submits without one.
        if (live.busy && !isBusy(opened.id)) {
            void sessions()
                .touch(opened.id)
                .then(
                    () => listChanged(opened.id),
                    (error: unknown) => {
                        console.error(error);
                    },
                );
        }

        // Taken before the browsers hear of it, so a `seen` sent the moment it ends is later.
        if (busy.get(opened.id) === true && !live.busy) {
            // An unhandled rejection would end the process, and every conversation in it.
            void sessions()
                .ended(opened.id, Date.now())
                .then(
                    () => listChanged(opened.id),
                    (error: unknown) => {
                        console.error(error);
                    },
                );
        }

        busy.set(opened.id, live.busy);

        // An entry that finishes the streamed answer comes with the frame that clears it, or the answer shows twice.
        if (!unchanged) {
            liveFrames.flush(opened.id);
        } else {
            liveFrames.changed(opened.id);
        }
    }

    /** Sends a state to the browsers and, with its busy value as it is now, to the extensions(). */
    function observe(opened: Opened, state: View): void {
        publish(opened, state);
        extensions().publish(commitView(state, busy.get(opened.id) === true));
    }

    const attaching = new Map<number, Promise<Opened | undefined>>();
    /** The attached view of each session, so a deleted one stops feeding the server its state. */
    const attached = new Map<number, () => void>();

    /** Opens a conversation and starts forwarding its commits. A caller that comes while it opens gets the same open. */
    function attach(id: number): Promise<Opened | undefined> {
        const known = attaching.get(id);

        if (known !== undefined) {
            return known;
        }

        const pending = attachOnce(id);

        attaching.set(id, pending);
        // Only the open in flight is shared: a deleted session must be refused again by `sessions().open`.
        void pending
            .finally(() => {
                attaching.delete(id);
            })
            .catch(() => undefined);

        return pending;
    }

    async function attachOnce(id: number): Promise<Opened | undefined> {
        const opened = await sessions().open(idOf(id));

        if (opened === undefined) {
            return undefined;
        }

        if (opened.watched) {
            return opened;
        }

        const watch = await opened.conversation.watch(context);

        opened.watched = true;
        opened.newestSent = Number(watch.value.entries.at(-1)?.id ?? 0);
        attached.set(id, () => {
            void watch.stop();
        });
        observe(opened, watch.value);
        watch.start((call) => {
            if (call.kind === "value") {
                observe(opened, call.value);
            } else {
                console.error("pi-durable-agent: the view of a session failed", call.error);
            }

            return Promise.resolve();
        });

        return opened;
    }

    /**
     * Drops everything the server holds for a session that is gone: its last state and busy mark, an open
     * still in flight, its attached view, and the state an extension is replayed after a reload. Without
     * this the extensions hear of it again on their next reload, and nothing can be sent to it any more.
     */
    function detach(id: number): void {
        attached.get(id)?.();
        attached.delete(id);
        liveFrames.forget(id);
        latest.delete(id);
        busy.delete(id);
        attaching.delete(id);
        extensions().forget(id);
    }

    /**
     * Starts the event stream of a session: the newest page of the state first, then every change. The page is cut
     * from the state `publish` stored for the attached view, the same state the browsers were sent up to, so no
     * commit can reach this client ahead of the `hello` that already carries it; nothing may await from reading
     * that state to sending it. Older history is what the view's `before` and the byte cut left out, and the
     * transcript pages it back.
     */
    function stream(request: IncomingMessage, response: ServerResponse, opened: Opened): void {
        const id = Number(opened.id);
        const view = viewOf(id);
        const page = helloPage(entriesOf(view));
        const live = liveOf(id, view);
        const client: Client = {
            response,
            gzip: openEventStream(request, response),
            session: id,
            held: live.blocks ?? [],
            heldQueued: live.queued ?? [],
            heldStatus: live.status ?? [],
        };

        clients.add(client);
        client.response.on("close", () => {
            clients.delete(client);
        });

        send(client, {
            type: "hello",
            session: id,
            entries: page.entries,
            live,
            model,
            more: page.cut || view.before !== undefined,
        });
    }

    return {
        attach,
        detach,
        stream,
        isBusy,
        working: sessionWorking,
        republish: () => {
            for (const { opened, view } of latest.values()) {
                publish(opened, view);
            }
        },
        notice: (notice) => {
            for (const client of clients) {
                send(client, { type: "extension-notice", session: client.session, notice });
            }
        },
        changed: changes.notify,
        heartbeat: () => {
            sendHeartbeat(clients);
        },
        dispose: () => {
            changes.dispose();
            liveFrames.dispose();
        },
    };
}
