import { normalizeContact, type DeviceSubscription } from "./refs.ts";

const WORKER_WAIT_MS = 5000;

export const OLD_WORKER =
    "An update is waiting. Close every window of this app, open it again, then enable notifications.";

/** The part of a `ServiceWorkerRegistration` that decides whether the active worker is current. */
export type WorkerState = { readonly waiting: unknown; readonly installing: unknown };

/** What enabling needs from the page and the server; the page passes the real ones. */
export type EnableParts = {
    notification: { permission: NotificationPermission; requestPermission: () => Promise<string> };
    /** The registration seen when the section loaded. It is live: `waiting` and `installing` stay current. */
    registration: WorkerState | undefined;
    ready: () => Promise<ServiceWorkerRegistration>;
    prepare: (contact: string) => Promise<string>;
    save: (subscription: DeviceSubscription) => Promise<void>;
};

/** A worker that waits is the new one; the active one is older and may not handle push. */
export function workerProblem(registration: WorkerState | undefined): string | undefined {
    if (registration?.waiting) {
        return OLD_WORKER;
    }

    return registration?.installing
        ? "The app is still installing an update. Try again in a moment."
        : undefined;
}

export async function readyWorker(): Promise<ServiceWorkerRegistration> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error("The service worker is not active. Reload the page and try again."));
        }, WORKER_WAIT_MS);
    });

    try {
        return await Promise.race([navigator.serviceWorker.ready, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
    const binary = atob(key.replaceAll("-", "+").replaceAll("_", "/"));

    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Turns notifications on for this device. It runs from a click, and the permission prompt must be
 * asked before the first `await`: Safari drops the user gesture after one. So the checks before the
 * prompt are synchronous, on the registration that the section already holds.
 */
export async function enable(contact: string, parts: EnableParts): Promise<string> {
    const saved = normalizeContact(contact);
    const problem = workerProblem(parts.registration);

    if (problem !== undefined) {
        throw new Error(problem);
    }

    const permission =
        parts.notification.permission === "granted"
            ? "granted"
            : await parts.notification.requestPermission();

    if (permission !== "granted") {
        throw new Error("Notifications were not allowed.");
    }

    const registration = await parts.ready();
    const late = workerProblem(registration);

    if (late !== undefined) {
        throw new Error(late);
    }

    const publicKey = await parts.prepare(saved);
    const existing = await registration.pushManager.getSubscription();
    const device =
        existing ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(publicKey),
        }));
    const { endpoint, keys } = device.toJSON();

    try {
        if (
            endpoint === undefined ||
            keys?.["p256dh"] === undefined ||
            keys["auth"] === undefined
        ) {
            throw new Error("The browser gave an incomplete subscription.");
        }

        await parts.save({ endpoint, keys: { p256dh: keys["p256dh"], auth: keys["auth"] } });
    } catch (error) {
        if (existing === null) {
            await device.unsubscribe().catch(() => false);
        }

        throw error;
    }

    return saved;
}
