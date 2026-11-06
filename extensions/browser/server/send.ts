import type { Json } from "./cdp.ts";

/** Sends one DevTools command to a page: its method, parameters, and how long to wait for the answer. */
export type Send = (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
) => Promise<Json>;
