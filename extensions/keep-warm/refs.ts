/**
 * What the keep-warm chip shows and what a ping reads: the cache's last request, the user's latest
 * input, and the last ping. Browser-safe: no imports.
 */
import { actionRef } from "../../shared/extension-api.ts";
import { isRecord } from "../../shared/guards.ts";

/** One keep-warm request: when, on which model, what it read from and wrote to the cache, or why it failed. */
export type Ping = { at: number; model: string; read?: number; write?: number; error?: string };

/** A conversation a ping is coming for: the popover lists these, so a spent plan is never a mystery. */
export type WarmSession = { id: number; label: string; nextAt: number };

export type WarmState = {
    on: boolean;
    /** The latest request on the conversation's cache, an answer or a ping (ms); the cache is warm for an hour after it. */
    lastRequest?: number;
    /** The user's latest input to the conversation (ms); pings stop 8 hours after it. */
    inputAt?: number;
    /** When the next ping is due (ms), while one will run. */
    nextAt?: number;
    last?: Ping;
    /** Every conversation a ping is coming for, the one asked last first. */
    sessions: WarmSession[];
};

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

function parseSession(value: unknown): WarmSession | undefined {
    if (!isRecord(value) || typeof value["id"] !== "number" || typeof value["label"] !== "string") {
        return undefined;
    }

    const nextAt = optionalNumber(value, "nextAt");

    return nextAt === undefined ? undefined : { id: value["id"], label: value["label"], nextAt };
}

function parseState(value: unknown): WarmState {
    if (!isRecord(value) || typeof value["on"] !== "boolean") {
        throw new Error("Invalid keep-warm state");
    }

    const lastRequest = optionalNumber(value, "lastRequest");
    const inputAt = optionalNumber(value, "inputAt");
    const nextAt = optionalNumber(value, "nextAt");
    const last = parsePing(value["last"]);
    const sessions = Array.isArray(value["sessions"])
        ? value["sessions"].flatMap((session) => parseSession(session) ?? [])
        : [];

    return {
        on: value["on"],
        sessions,
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
/**
 * User-only `{ id }`: stop pinging that conversation until the user writes in it again, which lifts
 * the stop on its own. Returns the state.
 */
export const stop = actionRef<{ id: number }, WarmState>("keep-warm", "stop", parseState);

// When a keep-warm ping is due; the chip reads the hour too.

/** The long prompt cache lives an hour from the last request that read or wrote it. */
export const TTL = 60 * 60_000;
/** Ping this long after the last request: late enough to be rare, early enough to land before the hour ends. */
export const LEAD = 55 * 60_000;
/** No ping once the user has been away this long. */
export const IDLE_STOP = 8 * 60 * 60_000;
/** The provider whose requests write the hour-long cache: others cache for minutes, or not at all. */
export const PROVIDER = "anthropic";

export type Activity = {
    now: number;
    /** The latest request on the cache: the last answer that used it, or the last ping (ms). */
    lastRequest?: number;
    /** The user's latest input (ms). */
    inputAt?: number;
    /** A ping failed after this request: none again until a newer one. */
    failedAfter?: number;
};

/**
 * Whether to ping now: the cache is still warm but about to expire, the user wrote within `IDLE_STOP`, and no ping
 * failed since the last request. A cache already past its hour is cold; a ping would only pay to rebuild it.
 */
export function due({ now, lastRequest, inputAt, failedAfter }: Activity): boolean {
    if (lastRequest === undefined || inputAt === undefined) {
        return false;
    }

    if (failedAfter !== undefined && failedAfter >= lastRequest) {
        return false;
    }

    const age = now - lastRequest;

    return age >= LEAD && age < TTL && now - inputAt < IDLE_STOP;
}
