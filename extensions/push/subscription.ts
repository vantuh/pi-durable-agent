import { ActionError } from "../../server/extensions.ts";
import type { DeviceSubscription } from "./refs.ts";

/**
 * The push services of the browsers. The device picks the endpoint and the server posts to it, so
 * any other host would let a caller aim the server at addresses only it can reach.
 */
const PUSH_HOSTS = [
    /^fcm\.googleapis\.com$/,
    /^android\.googleapis\.com$/,
    /(^|\.)push\.services\.mozilla\.com$/,
    /(^|\.)notify\.windows\.com$/,
    /(^|\.)push\.apple\.com$/,
];

const ENDPOINT_MAX = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function bytesOf(value: unknown, name: string): Buffer {
    if (typeof value !== "string" || !BASE64URL.test(value)) {
        throw new ActionError(`${name} must be base64url text`);
    }

    return Buffer.from(value, "base64url");
}

/** Checks a push endpoint without trusting the caller; returns it as given. */
export function validateEndpoint(value: unknown): string {
    if (typeof value !== "string" || value.length > ENDPOINT_MAX) {
        throw new ActionError("the endpoint must be text");
    }

    let url: URL;

    try {
        url = new URL(value);
    } catch {
        throw new ActionError("the endpoint is not a valid address");
    }

    if (
        url.protocol !== "https:" ||
        url.port !== "" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== "" ||
        !PUSH_HOSTS.some((host) => host.test(url.hostname))
    ) {
        throw new ActionError("the endpoint is not a known browser push service");
    }

    return value;
}

/** Checks the object that `PushSubscription.toJSON()` gives. */
export function validateSubscription(value: unknown): DeviceSubscription {
    const keys = isRecord(value) ? value["keys"] : undefined;

    if (!isRecord(value) || !isRecord(keys)) {
        throw new ActionError("the subscription must have an endpoint and keys");
    }

    const endpoint = validateEndpoint(value["endpoint"]);
    const p256dh = bytesOf(keys["p256dh"], "p256dh");
    const auth = bytesOf(keys["auth"], "auth");

    if (p256dh.length !== 65 || p256dh[0] !== 0x04) {
        throw new ActionError("p256dh must be an uncompressed P-256 point of 65 bytes");
    }

    if (auth.length !== 16) {
        throw new ActionError("auth must be 16 bytes");
    }

    return {
        endpoint,
        keys: { p256dh: String(keys["p256dh"]), auth: String(keys["auth"]) },
    };
}
