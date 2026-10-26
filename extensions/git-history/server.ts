import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host, type HttpHandler } from "../../server/extensions.ts";
import { readChanges, readHistory } from "./git.ts";
import { reviewProxy } from "./proxy.ts";
import { Reviews } from "./reviews.ts";

export const meta = {
    title: "Git history & review",
    description:
        "Browse commits and local changes, review in embedded Plannotator, and return feedback to the composer.",
};
// Ephemeral processes belong to one installed host version, never to another reload.
const instances = new WeakMap<Host, Reviews>();
export default function gitHistory(host: Host) {
    const reviews = new Reviews(`/api/extensions/${encodeURIComponent(host.name)}/http`);
    instances.set(host, reviews);
    host.onDispose(() => reviews.dispose());
    return defineExtension({ name: host.name });
}
function manager(host: Host): Reviews {
    const found = instances.get(host);
    if (found === undefined) {
        throw new Error("Git history has not been installed.");
    }
    return found;
}
function field(args: unknown, key: string): unknown {
    return typeof args === "object" && args !== null ? Reflect.get(args, key) : undefined;
}
function targetOf(args: unknown): string {
    const target = field(args, "target");
    if (
        typeof target !== "string" ||
        (target !== "worktree" && !/^[0-9a-f]{4,64}$/i.test(target))
    ) {
        throw new ActionError("Choose uncommitted changes or a commit from the history.");
    }
    return target;
}
function sessionOf(session: Parameters<Action>[0]["session"]): { id: number; cwd: string } {
    if (session?.cwd === null || session?.cwd === undefined) {
        throw new ActionError("Open a session with a working folder first.");
    }
    return { id: session.id, cwd: session.cwd };
}
export const actions = (host: Host): Record<string, Action> => ({
    history({ args, session }) {
        const limit = field(args, "limit");
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
            throw new ActionError("History limit must be between 1 and 200.");
        }
        return readHistory(sessionOf(session).cwd, limit);
    },
    changes({ args, session }) {
        return readChanges(sessionOf(session).cwd, targetOf(args));
    },
    start({ args, session }) {
        const current = sessionOf(session);
        return manager(host).start(current.id, current.cwd, targetOf(args));
    },
    review({ session }) {
        return manager(host).state(sessionOf(session).id);
    },
    cancel({ args, session }) {
        const id = field(args, "id");
        if (typeof id !== "string") {
            throw new ActionError("A review id is required.");
        }
        return manager(host).cancel(sessionOf(session).id, id);
    },
});
export const http = (host: Host): HttpHandler => reviewProxy(manager(host));
