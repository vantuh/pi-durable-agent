import webpush from "web-push";

import type { DeviceSubscription } from "./refs.ts";
import { type PushStore, withoutEndpoints } from "./store.ts";

/** How long one push service may take. A slow service must not hold the server. */
export const SEND_TIMEOUT_MS = 10_000;

/** What a transport needs to reach one device. It returns the HTTP status, or throws on a network fault. */
export type Transport = (
    device: DeviceSubscription,
    payload: string,
    vapid: { subject: string; publicKey: string; privateKey: string },
) => Promise<number>;

/** web-push encrypts the payload and signs the VAPID token; this code does neither. */
export const sendWithWebPush: Transport = async (device, payload, vapid) => {
    try {
        const result = await webpush.sendNotification(device, payload, {
            vapidDetails: vapid,
            TTL: 3600,
            timeout: SEND_TIMEOUT_MS,
        });

        return result.statusCode;
    } catch (error) {
        const status: unknown = error instanceof Error ? Reflect.get(error, "statusCode") : 0;

        if (typeof status === "number") {
            return status;
        }

        throw error;
    }
};

/** The payload for a finished turn. It names the conversation by number and says nothing of its content. */
export function finishedPayload(session: number): string {
    return JSON.stringify({
        title: "Pi finished",
        body: "A conversation has a new answer.",
        url: `/?session=${String(session)}`,
        tag: `session-${String(session)}`,
    });
}

/**
 * Sends to every device. A device that answers 404 or 410 is gone for good and is removed; any
 * other failure (a timeout, a 5xx, a refused connection) keeps it for the next time.
 */
export async function notifyAll(
    store: PushStore,
    transport: Transport,
    payload: string,
): Promise<void> {
    const file = await store.read();

    if (file.contact === null || file.vapid === null || file.subscriptions.length === 0) {
        return;
    }

    const vapid = { subject: file.contact, ...file.vapid };
    const gone = new Set<string>();

    await Promise.all(
        file.subscriptions.map(async (device) => {
            try {
                const status = await transport(device, payload, vapid);

                if (status === 404 || status === 410) {
                    gone.add(device.endpoint);
                }
            } catch {
                // Transient: the device stays.
            }
        }),
    );

    if (gone.size > 0) {
        await store.update((current) => ({ file: withoutEndpoints(current, gone), result: null }));
    }
}
