/**
 * What a ping is decided on, from what the commits published and from the state file. No I/O, so the
 * rules can be tested on their own.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";

import type { CommitView } from "../../server/sdk.ts";
import { due, IDLE_STOP, LEAD, PROVIDER, TTL, type Activity } from "./due.ts";
import type { Ping, WarmSession } from "./refs.ts";

/** What the commits say about one conversation. */
export type Seen = {
    /** The user's newest input (ms). */
    inputAt?: number;
    /** The newest answer that read or wrote a model's cache: what renews the hour. */
    cached?: { at: number; model: string };
    /** How the popover names it while the core has no title for it: the folder it works in. */
    label: string;
    /** A run is live: nothing is sent on top of it. */
    busy: boolean;
};

/** What the state file holds: the switch, and the last ping of every conversation. */
export type Stored = { off?: true; last?: Record<string, Ping> };

/** An answer that came back and used the cache. A failed answer or one without cache tokens renewed nothing. */
export function cached(message: AssistantMessage): boolean {
    return (
        message.provider === PROVIDER &&
        message.stopReason !== "error" &&
        message.stopReason !== "aborted" &&
        message.usage.cacheRead + message.usage.cacheWrite > 0
    );
}

/** The folder a session works in, for one the core has no name for yet. */
function folderOf(cwd: string | null): string {
    return (
        cwd
            ?.split("/")
            .filter((part) => part !== "")
            .pop() ?? "conversation"
    );
}

/** Folds one commit into what is known about its conversation: the last input and the last cached answer. */
export function observe(seen: Map<number, Seen>, view: CommitView): void {
    const id = view.session.id;
    const known = seen.get(id);
    let inputAt = known?.inputAt;
    let cachedAt = known?.cached;

    for (const entry of view.entries) {
        const message = entry.model?.[0];

        if (message?.role === "user") {
            if (inputAt === undefined || message.timestamp > inputAt) {
                inputAt = message.timestamp;
            }
        }

        if (
            message?.role === "assistant" &&
            cached(message) &&
            (cachedAt === undefined || message.timestamp > cachedAt.at)
        ) {
            cachedAt = { at: message.timestamp, model: message.model };
        }
    }

    seen.set(id, {
        ...(inputAt === undefined ? {} : { inputAt }),
        ...(cachedAt === undefined ? {} : { cached: cachedAt }),
        label: folderOf(view.session.cwd),
        busy: view.busy,
    });
}

/** When the conversation's own requests last renewed `model`'s cache: its newest such answer or ping. */
export function lastRequestOf(
    seen: Seen | undefined,
    last: Ping | undefined,
    model: string,
): number | undefined {
    const answered = seen?.cached?.model === model ? seen.cached.at : undefined;
    const pinged = last?.error === undefined && last?.model === model ? last.at : undefined;

    return Math.max(answered ?? 0, pinged ?? 0) || undefined;
}

/** What one conversation's times are, on the model it runs now. */
export type Found = {
    readonly now: number;
    /** Absent until something renewed this model's cache. */
    readonly lastRequest?: number;
    readonly inputAt?: number;
    readonly failedAfter?: number;
    readonly last?: Ping;
};

/** The times a ping is decided on, for one conversation and its model. */
export function activityOf(
    stored: Stored,
    session: number,
    seen: Seen | undefined,
    model: string,
    now: number,
): Found {
    const last = stored.last?.[String(session)];
    const lastRequest = lastRequestOf(seen, last, model);

    return {
        now,
        ...(lastRequest === undefined ? {} : { lastRequest }),
        ...(seen?.inputAt === undefined ? {} : { inputAt: seen.inputAt }),
        ...(last?.error === undefined ? {} : { failedAfter: last.at }),
        ...(last === undefined ? {} : { last }),
    };
}

/**
 * When the next ping is due, while one will run: the lead, but only if a ping would be due then — a
 * user away longer than `IDLE_STOP`, or a failed ping, means none is coming.
 */
export function nextOf(activity: Activity & { lastRequest: number }): number | undefined {
    const lead = activity.lastRequest + LEAD;

    return due({ ...activity, now: Math.max(activity.now, lead) }) ? lead : undefined;
}

/** The conversations a ping is coming for, the one asked last first: what the popover lists. */
export function warming(stored: Stored, seen: Map<number, Seen>, now: number): WarmSession[] {
    const found: { id: number; inputAt: number; label: string; nextAt: number }[] = [];

    for (const [id, known] of seen) {
        const { inputAt } = known;

        if (inputAt === undefined || now - inputAt >= IDLE_STOP) {
            continue;
        }

        const model = known.cached?.model ?? stored.last?.[String(id)]?.model;

        if (model === undefined) {
            continue;
        }

        const activity = activityOf(stored, id, known, model, now);
        const { lastRequest } = activity;
        const nextAt = lastRequest === undefined ? undefined : nextOf({ ...activity, lastRequest });

        if (nextAt !== undefined) {
            found.push({ id, inputAt, label: known.label, nextAt });
        }
    }

    return found
        .sort((a, b) => b.inputAt - a.inputAt)
        .map(({ id, label, nextAt }) => ({ id, label, nextAt }));
}

/**
 * Right before sending: still on, still idle, and the hour not over. A cache already past its hour is
 * cold, and a ping then would only pay to rebuild it.
 */
export function open(off: boolean, busy: boolean, lastRequest: number, now: number): boolean {
    return !off && !busy && now - lastRequest < TTL;
}
