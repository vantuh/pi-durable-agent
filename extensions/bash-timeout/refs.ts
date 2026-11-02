/**
 * What the server and the browser half agree on about the limit. Browser-safe: the contract and the
 * check both halves use.
 */

import { actionRef } from "../../shared/extension-api.ts";

/** Where the setting is kept, in the data directory. */
export const FILE = "bash-timeout.json";

/** Whole minutes: the longest one bash command may run. */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 120;
export const DEFAULT_MINUTES = 10;

/** What the file holds, and what both actions answer. */
export type BashTimeout = { minutes: number };

export function isMinutes(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= MIN_MINUTES &&
        value <= MAX_MINUTES
    );
}

/** The answer of either action, checked: a malformed one throws. */
function parseBashTimeout(value: unknown): BashTimeout {
    const minutes: unknown =
        typeof value === "object" && value !== null ? Reflect.get(value, "minutes") : undefined;

    if (!isMinutes(minutes)) {
        throw new Error("the bash timeout is malformed");
    }

    return { minutes };
}

/** The limit in force. */
export const settings = actionRef<undefined, BashTimeout>(
    "bash-timeout",
    "settings",
    parseBashTimeout,
);

/** Saves the limit; the answer is what the file holds from then on. */
export const saveSettings = actionRef<BashTimeout, BashTimeout>(
    "bash-timeout",
    "saveSettings",
    parseBashTimeout,
);
