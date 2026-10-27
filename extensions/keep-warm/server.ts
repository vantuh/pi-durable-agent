/**
 * Keep warm: the provider keeps a conversation's prompt cache for an hour after each request. Shortly
 * before that hour ends, with the conversation idle and the user away less than eight hours, one
 * request replays its context as the next request would send it plus a one-word question. It reads the
 * whole prefix from the cache, which renews the hour, and adds nothing to the transcript.
 */
import type { Message } from "@earendil-works/pi-ai";
import { defineExtension } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host, type SessionRequest } from "../../server/sdk.ts";
import { due, PROVIDER } from "./due.ts";
import { type Ping, type WarmSession, type WarmState } from "./refs.ts";
import { readStore, writeStore } from "./store.ts";
import {
    activityOf,
    nextOf,
    observe,
    open,
    stopped,
    warming,
    type Seen,
    type Stored,
} from "./warm.ts";

export const meta = {
    title: "Keep warm",
    description:
        "Renews the conversation's prompt cache while you are away, so your next message reads it.",
};

/** How often the timer looks; a ping lands within a minute after the lead, well inside the hour. */
const TICK = 60_000;
const TIMEOUT_MS = 180_000;
const QUESTION =
    "Cache keep-warm check from pi-durable-agent, not from the user. Reply with just: ok";

/**
 * The live instance: the default export fills it, the actions read and write it. A reload imports this
 * file anew, so every load starts from the state file.
 */
let seen = new Map<number, Seen>();
let stored: Stored = {};
let running: Promise<void> | undefined;

async function remember(host: Host, session: number, attempt: Ping): Promise<void> {
    stored = { ...stored, last: { ...stored.last, [String(session)]: attempt } };
    await writeStore(host.dataDir, stored);
}

/**
 * One request with the conversation's next context and the question. The attempt is stored before it
 * is sent, so a crash mid-request counts as a failure, never a retry; and a failure is kept as the last
 * ping, which blocks further ones until the conversation's next request, so no loop.
 */
async function ping(
    host: Host,
    session: number,
    request: SessionRequest,
    lastRequest: number,
): Promise<void> {
    const at = Date.now();
    const model = request.model.id;
    const busy = () => seen.get(session)?.busy === true;

    if (!open(stored.off === true, busy(), lastRequest, at)) {
        return;
    }

    await remember(host, session, { at, model, error: "interrupted" });

    // Preparing the context awaited, so the switch, a run, or the hour itself may have moved on.
    if (!open(stored.off === true, busy(), lastRequest, Date.now())) {
        await remember(host, session, { at, model, error: "skipped: off, busy or expired" });

        return;
    }

    const messages: Message[] = [
        ...request.messages,
        { role: "user", content: QUESTION, timestamp: at },
    ];

    try {
        const answer = await request.send(messages, AbortSignal.timeout(TIMEOUT_MS));
        const failed = answer.stopReason === "error" || answer.stopReason === "aborted";

        await remember(
            host,
            session,
            failed
                ? { at, model, error: answer.errorMessage ?? answer.stopReason }
                : { at, model, read: answer.usage.cacheRead, write: answer.usage.cacheWrite },
        );
    } catch (error) {
        await remember(host, session, {
            at,
            model,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function tick(host: Host): Promise<void> {
    if (stored.off === true) {
        return;
    }

    for (const session of [...seen.keys()]) {
        const known = seen.get(session);

        if (known?.busy === true) {
            continue;
        }

        const request = await host.sessionRequest(session);

        if (request === undefined) {
            // Nothing can be sent to it any more: deleted, unknown, or no model chosen. Forget it, so
            // the popover stops promising a ping that will never run.
            seen.delete(session);
            continue;
        }

        if (request.model.provider !== PROVIDER) {
            continue;
        }

        const activity = activityOf(stored, session, known, request.model.id, Date.now());

        if (
            activity.lastRequest === undefined ||
            !due(activity) ||
            stopped(stored, session, activity.inputAt)
        ) {
            continue;
        }

        await ping(host, session, request, activity.lastRequest);
    }
}

/**
 * The warmed conversations, each named as the sidebar names it. The core owns titles, so the label
 * the commits alone can guess is only the fallback for a session it has no name for yet.
 */
async function named(host: Host, rows: readonly WarmSession[]): Promise<WarmSession[]> {
    return await Promise.all(
        rows.map(async (row) => ({
            ...row,
            label: (await host.sessionTitle(row.id)) ?? row.label,
        })),
    );
}

async function stateOf(host: Host, session: number | undefined): Promise<WarmState> {
    const on = stored.off !== true;
    const sessions = on ? await named(host, warming(stored, seen, Date.now())) : [];

    if (session === undefined) {
        return { on, sessions };
    }

    const request = await host.sessionRequest(session);

    if (request === undefined) {
        return { on, sessions };
    }

    const known = seen.get(session);
    const activity = activityOf(stored, session, known, request.model.id, Date.now());
    const { lastRequest } = activity;
    const nextAt =
        on && lastRequest !== undefined ? nextOf({ ...activity, lastRequest }) : undefined;

    return {
        on,
        sessions,
        ...(lastRequest === undefined ? {} : { lastRequest }),
        ...(known?.inputAt === undefined ? {} : { inputAt: known.inputAt }),
        ...(nextAt === undefined ? {} : { nextAt }),
        ...(activity.last === undefined ? {} : { last: activity.last }),
    };
}

export default async function keepWarm(host: Host) {
    stored = await readStore(host.dataDir);
    seen = new Map();
    host.onCommit((view) => {
        observe(seen, view);
    });
    // Outside the scheduler on purpose: a pause holds the scheduler, not this.
    const timer = setInterval(() => {
        running ??= tick(host)
            .catch((error: unknown) => {
                host.log(`keep-warm: ${String(error)}`);
            })
            .finally(() => {
                running = undefined;
            });
    }, TICK);

    host.onDispose(async () => {
        clearInterval(timer);
        await running;
    });

    return defineExtension({ name: host.name });
}

export const actions = (host: Host): Record<string, Action> => ({
    state: ({ session }) => stateOf(host, session?.id),
    set: async ({ args, session }) => {
        const on = typeof args === "object" && args !== null ? Reflect.get(args, "on") : undefined;

        if (typeof on !== "boolean") {
            throw new ActionError("args must be { on: boolean }");
        }

        if (on) {
            const { off: _, ...rest } = stored;

            stored = rest;
        } else {
            stored = { ...stored, off: true };
        }

        await writeStore(host.dataDir, stored);

        return await stateOf(host, session?.id);
    },
    stop: async ({ args, session }) => {
        const id = typeof args === "object" && args !== null ? Reflect.get(args, "id") : undefined;

        if (typeof id !== "number") {
            throw new ActionError("args must be { id: number }");
        }

        stored = { ...stored, stop: { ...stored.stop, [String(id)]: Date.now() } };
        await writeStore(host.dataDir, stored);

        return await stateOf(host, session?.id);
    },
});
