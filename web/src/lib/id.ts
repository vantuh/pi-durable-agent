/**
 * `crypto.randomUUID` is missing outside a secure context, which is what a phone reaching this
 * machine over plain HTTP on the LAN is; `getRandomValues` is there everywhere. 128 random bits,
 * the same as the UUID it stands in for, in hex.
 */
export function randomId(): string {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}
