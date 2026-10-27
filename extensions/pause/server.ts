/**
 * Holds a running conversation at its next step and lets it go on, instead of stopping it.
 *
 * A step is one model request or one tool call, so nothing new starts while the gate is closed and
 * the step already running finishes first: `beforeTool` holds the next call before it runs, and
 * `beforeRequest` holds the next request before it leaves. Freezing a step mid-flight is not
 * something a hook can do — it would mean freezing a provider stream or a child process — so a
 * pause pressed while a tool runs lands after that tool.
 */
import { defineExtension, GenerationTask, hook, ToolTask } from "@earendil-works/pi-durable";

import { type Action, ActionError, type Host } from "../../server/sdk.ts";
import { Gate } from "./gate.ts";

export const meta = {
    title: "Pause",
    description: "Holds a running conversation after its current step, and lets it go on again.",
};

/** Keyed by conversation, which is the session number the browser uses. */
const gates = new Map<number, Gate>();
/** Whether a session has a run to hold. Followed from commits; a session never seen reads false. */
const running = new Map<number, boolean>();

function gateOf(session: number): Gate {
    const known = gates.get(session);

    if (known !== undefined) {
        return known;
    }

    const gate = new Gate();
    gates.set(session, gate);

    return gate;
}

function named(call: { readonly session: { readonly id: number } | null }): number {
    if (call.session === null) {
        throw new ActionError("a session is needed");
    }

    return call.session.id;
}

export const actions: Record<string, Action> = {
    pause(call) {
        const session = named(call);

        // Nothing to hold in an idle session, and a pause nobody asked for would hang its next run.
        if (running.get(session) !== true) {
            return { paused: false };
        }

        gateOf(session).pause();

        return { paused: true };
    },
    resume(call) {
        gateOf(named(call)).resume();

        return { paused: false };
    },
    state(call) {
        return { paused: gates.get(named(call))?.paused === true };
    },
};

export default function pause(host: Host) {
    host.onCommit((view) => {
        running.set(view.session.id, view.busy);

        // Nothing is left to hold once a run ends, so the next one starts unpaused.
        if (!view.busy) {
            gates.get(view.session.id)?.resume();
        }
    });

    // A replaced or removed version must not leave work parked on a gate nobody can open.
    host.onDispose(() => {
        for (const gate of gates.values()) {
            gate.resume();
        }
        gates.clear();
        running.clear();
    });

    return defineExtension({
        name: host.name,
        hooks: [
            hook(ToolTask, {
                beforeTool: async (_call, api, context) => {
                    await gateOf(api.conversationId).hold(context);

                    return undefined;
                },
            }),
            hook(GenerationTask, {
                beforeRequest: async (_request, api, context) => {
                    await gateOf(api.conversationId).hold(context);

                    return undefined;
                },
            }),
        ],
    });
}
