/**
 * What the keep-warm chip shows and what a ping reads: the cache's last request, the user's latest
 * input, and the last ping. Browser-safe: no imports.
 */
import { actionRef } from "../../shared/extension-api.ts";

/** One keep-warm request: when, on which model, what it read from and wrote to the cache, or why it failed. */
export type Ping = { at: number; model: string; read?: number; write?: number; error?: string };

export type WarmState = {
    on: boolean;
    /** The latest request on the conversation's cache, an answer or a ping (ms); the cache is warm for an hour after it. */
    lastRequest?: number;
    /** The user's latest input to the conversation (ms); pings stop 8 hours after it. */
    inputAt?: number;
    /** When the next ping is due (ms), while one will run. */
    nextAt?: number;
    last?: Ping;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function optionalNumber(source: Record<string, unknown>, key: string): number | undefined {
    const value = source[key];

    return typeof value === "number" ? value : undefined;
}

function parsePing(value: unknown): Ping | undefined {
    if (!isRecord(value) || typeof value["at"] !== "number" || typeof value["model"] !== "string") {
        return undefined;
    }

    const read = optionalNumber(value, "read");
    const write = optionalNumber(value, "write");
    const error = typeof value["error"] === "string" ? value["error"] : undefined;

    return {
        at: value["at"],
        model: value["model"],
        ...(read === undefined ? {} : { read }),
        ...(write === undefined ? {} : { write }),
        ...(error === undefined ? {} : { error }),
    };
}

function parseState(value: unknown): WarmState {
    if (!isRecord(value) || typeof value["on"] !== "boolean") {
        throw new Error("Invalid keep-warm state");
    }

    const lastRequest = optionalNumber(value, "lastRequest");
    const inputAt = optionalNumber(value, "inputAt");
    const nextAt = optionalNumber(value, "nextAt");
    const last = parsePing(value["last"]);

    return {
        on: value["on"],
        ...(lastRequest === undefined ? {} : { lastRequest }),
        ...(inputAt === undefined ? {} : { inputAt }),
        ...(nextAt === undefined ? {} : { nextAt }),
        ...(last === undefined ? {} : { last }),
    };
}

/** No arguments: whether it is on, the cache's last request, the next ping and the last one, for one session. */
export const state = actionRef<undefined, WarmState>("keep-warm", "state", parseState);
/** User-only `{ on }`: keep the conversation's cache warm, or stop. Returns the state. */
export const set = actionRef<{ on: boolean }, WarmState>("keep-warm", "set", parseState);
