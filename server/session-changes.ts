/**
 * What an extension says about a session that its own commits do not show: a conversation it
 * started changed. Each session has a revision that moves once per window however often it is
 * told, so a child that commits every moment makes the browser ask once, not every time.
 */
export type SessionChanges = {
    /** The session's revision: 0 until the first change. */
    revision: (session: number) => number;
    /** Moves the revision when the window ends and calls `changed` once; a notify inside the window joins it. */
    notify: (session: number) => void;
    dispose: () => void;
};

export function sessionChanges(options: {
    windowMs: number;
    changed: (session: number) => void;
}): SessionChanges {
    const revisions = new Map<number, number>();
    const waiting = new Map<number, NodeJS.Timeout>();

    return {
        revision: (session) => revisions.get(session) ?? 0,
        notify: (session) => {
            if (waiting.has(session)) {
                return;
            }

            waiting.set(
                session,
                setTimeout(() => {
                    waiting.delete(session);
                    revisions.set(session, (revisions.get(session) ?? 0) + 1);
                    options.changed(session);
                }, options.windowMs),
            );
        },
        dispose: () => {
            for (const timer of waiting.values()) {
                clearTimeout(timer);
            }

            waiting.clear();
        },
    };
}
