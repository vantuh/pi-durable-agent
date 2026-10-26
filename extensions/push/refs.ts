import { actionRef } from "../../shared/extension-api.ts";

/** What the browser sends for one device; the server checks every field again. */
export type DeviceSubscription = {
    endpoint: string;
    keys: { p256dh: string; auth: string };
};

export type PushState = {
    /** The VAPID contact, or null before the owner gave one. */
    contact: string | null;
    /** True once keys exist, so a device can subscribe. */
    ready: boolean;
    /** True when the server holds the subscription with the asked endpoint. */
    subscribed: boolean;
};

const CONTACT_MAX = 200;
const EMAIL = /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/;
const LOCAL_HOST = /(^|\.)(localhost|local|internal)$|^\d+\.\d+\.\d+\.\d+$|^\[/;

/**
 * The VAPID contact is what a push service uses to reach the owner of this server, so it must be
 * real: an email (with or without `mailto:`) or an https address on a public name.
 */
export function normalizeContact(value: unknown): string {
    if (typeof value !== "string") {
        throw new Error("the contact must be text");
    }

    const text = value.trim();
    const mail = text.replace(/^mailto:/i, "");

    if (text.length > CONTACT_MAX) {
        throw new Error("the contact is too long");
    }

    if (EMAIL.test(mail)) {
        return `mailto:${mail}`;
    }

    let url: URL | undefined;

    try {
        url = new URL(text);
    } catch {
        url = undefined;
    }

    if (
        url === undefined ||
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        LOCAL_HOST.test(url.hostname)
    ) {
        throw new Error(
            "the contact must be an email address or an https address on a public name",
        );
    }

    return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseState(value: unknown): PushState {
    const contact = isRecord(value) ? value["contact"] : undefined;

    if (
        !isRecord(value) ||
        (contact !== null && typeof contact !== "string") ||
        typeof value["ready"] !== "boolean" ||
        typeof value["subscribed"] !== "boolean"
    ) {
        throw new Error("the push state is malformed");
    }

    return { contact, ready: value["ready"], subscribed: value["subscribed"] };
}

/** The saved contact, whether keys exist, and whether the device with this endpoint is subscribed. */
export const state = actionRef<{ endpoint: string | null }, PushState>("push", "state", parseState);

/** Saves the contact and makes the keys on first use. The result is the public key for `subscribe()`. */
export const prepare = actionRef<{ contact: string }, { publicKey: string }>(
    "push",
    "prepare",
    (value) => {
        const key = isRecord(value) ? value["publicKey"] : undefined;

        if (typeof key !== "string" || key === "") {
            throw new Error("the public key is missing");
        }

        return { publicKey: key };
    },
);

function parseDone(value: unknown): { done: true } {
    if (!isRecord(value) || value["done"] !== true) {
        throw new Error("the server did not confirm");
    }

    return { done: true };
}

export const subscribe = actionRef<{ subscription: DeviceSubscription }, { done: true }>(
    "push",
    "subscribe",
    parseDone,
);

/** Removes this device only. */
export const unsubscribe = actionRef<{ endpoint: string }, { done: true }>(
    "push",
    "unsubscribe",
    parseDone,
);
