/**
 * Web Push: a notification on your devices when Pi finishes a turn. The text is generic and the
 * link opens the conversation. Needs a secure context (HTTPS or localhost) and a production build for the worker.
 */

import { defineExtension } from "@earendil-works/pi-durable";
import webpush from "web-push";

import { ActionError, type Action, type CommitView, type Host } from "../../server/extensions.ts";
import { Completions } from "./completion.ts";
import { normalizeContact } from "./refs.ts";
import { finishedPayload, notifyAll, sendWithWebPush, type Transport } from "./send.ts";
import { PushStore, withoutEndpoints, withSeen, withSubscription } from "./store.ts";
import { validateEndpoint, validateSubscription } from "./subscription.ts";

export const meta = {
    title: "Push notifications",
    description: "Sends a notification to your devices when Pi finishes an answer.",
};

function argOf(args: unknown, name: string): unknown {
    return typeof args === "object" && args !== null ? Reflect.get(args, name) : undefined;
}

/** The actions, over a store. Exported so tests can use a store in a temporary folder. */
export function pushActions(store: PushStore): Record<string, Action> {
    return {
        async state({ args }) {
            const endpoint = argOf(args, "endpoint");
            const file = await store.read();

            return {
                contact: file.contact,
                ready: file.vapid !== null,
                subscribed:
                    typeof endpoint === "string" &&
                    file.subscriptions.some((device) => device.endpoint === endpoint),
            };
        },

        async prepare({ args }) {
            let contact: string;

            try {
                contact = normalizeContact(argOf(args, "contact"));
            } catch (error) {
                throw new ActionError(error instanceof Error ? error.message : "bad contact");
            }

            return await store.update((file) => {
                const vapid = file.vapid ?? webpush.generateVAPIDKeys();

                return {
                    file: { ...file, contact, vapid },
                    result: { publicKey: vapid.publicKey },
                };
            });
        },

        async subscribe({ args }) {
            const subscription = validateSubscription(argOf(args, "subscription"));

            await store.update((file) => {
                if (file.vapid === null || file.contact === null) {
                    throw new ActionError("set the contact before subscribing");
                }

                return { file: withSubscription(file, subscription), result: null };
            });

            return { done: true };
        },

        async unsubscribe({ args }) {
            const endpoint = validateEndpoint(argOf(args, "endpoint"));

            await store.update((file) => ({
                file: withoutEndpoints(file, new Set([endpoint])),
                result: null,
            }));

            return { done: true };
        },
    };
}

export const actions = (host: Host): Record<string, Action> =>
    pushActions(new PushStore(host.dataDir));

export function listen(host: Host, store: PushStore, transport: Transport): void {
    const completions = new Completions();
    let live = true;
    let queue: Promise<void> = Promise.resolve();

    host.onDispose(() => {
        live = false;
    });

    /** Commits are handled one at a time, in order: each reads the settled point the last one saved. */
    const handle = async (view: CommitView): Promise<void> => {
        const key = String(view.session.id);

        // Decided on the file as it is when this change runs, so versions that overlap cannot both
        // count a turn. Past the save the turn is ours: a disposal now must not drop it, because
        // the next version would see the saved point and skip it. A version that is already
        // disposed claims nothing.
        const done = await store.update((file) => {
            if (!live) {
                return { file: null, result: 0 };
            }

            const persisted = file.seen[key];
            const found = completions.observe(view, persisted);

            // Without a device only the in-memory baseline moves. A stale view never moves a point back.
            if (file.subscriptions.length === 0) {
                return { file: null, result: 0 };
            }

            return {
                file:
                    persisted === undefined || found.settled > persisted
                        ? withSeen(file, view.session.id, found.settled)
                        : null,
                result: found.done,
            };
        });

        for (let turn = 0; turn < done; turn += 1) {
            void notifyAll(store, transport, finishedPayload(view.session.id)).catch(() => {
                host.log("push: a notification could not be sent");
            });
        }
    };

    host.onCommit((view) => {
        queue = queue.then(
            () => handle(view),
            () => handle(view),
        );

        return queue.catch(() => {
            host.log("push: a commit could not be handled");
        });
    });
}

export default function push(host: Host) {
    listen(host, new PushStore(host.dataDir), sendWithWebPush);

    return defineExtension({ name: host.name });
}
