/**
 * How often a session's browsers hear of it. A commit lands about every 100 ms while an answer streams; this lets
 * one frame go per window. The first change after a quiet window goes at once, so the first token does not wait,
 * and the changes inside a window become one more at its end, which is what keeps the last commit of a run from
 * being swallowed. `send` reads the newest state when it is called, so a frame never carries an old one.
 */
export type LiveWindow = {
    /** Sends now if the last send is a window old, else once at the end of the window. */
    changed: (session: number) => void;
    /** Sends now, whatever the window says, and cancels the send that was waiting. */
    flush: (session: number) => void;
    /** Drops what is held for a session that is gone. */
    forget: (session: number) => void;
    dispose: () => void;
};

export function liveWindow(options: {
    windowMs: number;
    send: (session: number) => void;
}): LiveWindow {
    const sentAt = new Map<number, number>();
    const waiting = new Map<number, NodeJS.Timeout>();

    const flush = (session: number): void => {
        clearTimeout(waiting.get(session));
        waiting.delete(session);
        sentAt.set(session, Date.now());
        options.send(session);
    };

    return {
        changed: (session) => {
            if (waiting.has(session)) {
                return;
            }

            const wait = (sentAt.get(session) ?? 0) + options.windowMs - Date.now();

            if (wait <= 0) {
                flush(session);

                return;
            }

            waiting.set(
                session,
                setTimeout(() => {
                    flush(session);
                }, wait),
            );
        },
        flush,
        forget: (session) => {
            clearTimeout(waiting.get(session));
            waiting.delete(session);
            sentAt.delete(session);
        },
        dispose: () => {
            for (const timer of waiting.values()) {
                clearTimeout(timer);
            }

            waiting.clear();
        },
    };
}
