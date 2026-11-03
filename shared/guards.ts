/**
 * Reading `unknown`. Everything this app parses or catches — a request body, a provider's response, a
 * file an older version wrote, a failure — arrives unchecked, and every side reads it the same way.
 * Browser-safe: no imports.
 */

/** A plain object: not `null`, not an array. An array is read by index and its `length`, never by key. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The record, or `undefined` for anything else: for a caller that reads many keys and wants the value. */
export function recordOf(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

/** What a failure is, in words: its own message, or whatever it turned out to be. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
