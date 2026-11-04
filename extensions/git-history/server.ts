import { defineExtension } from "@earendil-works/pi-durable";

import { ActionError, type Action, type Host, type HttpHandler } from "../../server/sdk.ts";
import { readChanges, readCommit, readHistory, reword as rewordCommit } from "./git.ts";
import { reviewProxy } from "./proxy.ts";
import type { Changes } from "./refs.ts";
import { Reviews } from "./reviews.ts";
import { statsActions } from "./stats.ts";

export const meta = {
    title: "Git history & review",
    description:
        "Header badge with changed lines, ahead/behind counts and a safe push button; browse commits and local changes, review in embedded Plannotator, and return feedback to the composer.",
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
/** A commit's diff never changes, so a second look costs nothing; the working tree is read every time. */
const CHANGES_KEPT = 20;
const read = new Map<string, Changes>();

function changesOf(cwd: string, target: string): Promise<Changes> {
    if (target === "worktree") {
        return readChanges(cwd, target);
    }
    const key = `${cwd}\u0000${target}`;
    const found = read.get(key);
    if (found !== undefined) {
        // Re-inserted, so the entry kept longest is the one used longest ago.
        read.delete(key);
        read.set(key, found);
        return Promise.resolve(found);
    }
    return readChanges(cwd, target).then((result) => {
        read.set(key, result);
        const oldest = read.keys().next().value;
        if (read.size > CHANGES_KEPT && oldest !== undefined) {
            read.delete(oldest);
        }
        return result;
    });
}

export const actions = (host: Host): Record<string, Action> => ({
    ...statsActions,
    history({ args, session }) {
        const limit = field(args, "limit");
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
            throw new ActionError("History limit must be between 1 and 200.");
        }
        return readHistory(sessionOf(session).cwd, limit);
    },
    changes({ args, session }) {
        const current = sessionOf(session);
        return changesOf(current.cwd, targetOf(args));
    },
    commit({ args, session }) {
        const target = field(args, "target");
        if (typeof target !== "string" || !/^[0-9a-f]{4,64}$/i.test(target)) {
            throw new ActionError("Choose a commit from the history.");
        }
        return readCommit(sessionOf(session).cwd, target);
    },
    reword({ args, session }) {
        const hash = field(args, "hash");
        const subject = field(args, "subject");
        const body = field(args, "body");
        if (typeof hash !== "string" || !/^[0-9a-f]{4,64}$/i.test(hash)) {
            throw new ActionError("Choose a commit from the history.");
        }
        if (typeof subject !== "string" || subject.includes("\n") || subject.trim() === "") {
            throw new ActionError("A commit needs a title of one line.");
        }
        return rewordCommit(
            sessionOf(session).cwd,
            hash,
            subject.trim(),
            typeof body === "string" ? body.trim() : "",
        );
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
