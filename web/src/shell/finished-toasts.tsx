import { useEffect, useRef } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedBetween, working } from "../lib/finished.ts";
import { showSessionAlert } from "./session-alert.tsx";
import { folderName } from "./session-parts.tsx";

let audio: AudioContext | undefined;

/** Two falling notes. The browser lets it play once the page had a click or key press, as sending does. */
function chime(): void {
    audio ??= new AudioContext();
    void audio.resume();

    const now = audio.currentTime;

    for (const [offset, pitch] of [
        [0, 988],
        [0.12, 740],
    ] as const) {
        const tone = audio.createOscillator();
        const volume = audio.createGain();
        const at = now + offset;

        tone.frequency.setValueAtTime(pitch, at);
        volume.gain.setValueAtTime(0.0001, at);
        volume.gain.exponentialRampToValueAtTime(0.1, at + 0.01);
        volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        tone.connect(volume).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.31);
    }
}

/** A parent's report reaches it a moment after its last child idles; a run that starts again in this time did not finish. */
const SETTLE_MS = 3000;

/**
 * A toast when another session stops working; a click anywhere on it opens that session. A chime when
 * any top-level session does, the one on screen included. A session works while its own run or any
 * subagent below it does, and the signal comes only once it has stayed idle for a moment.
 */
export function useFinishedToasts(
    sessions: SessionSummary[],
    current: number | null,
    onOpen: (id: number) => void,
): void {
    const before = useRef<SessionSummary[]>([]);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    const latest = useRef({ sessions, current, onOpen });

    useEffect(() => {
        latest.current = { sessions, current, onOpen };

        for (const candidate of finishedBetween(before.current, sessions, null)) {
            if (timers.current.has(candidate.id)) {
                continue;
            }

            timers.current.set(
                candidate.id,
                setTimeout(() => {
                    timers.current.delete(candidate.id);

                    const now = latest.current;
                    const session = now.sessions.find((row) => row.id === candidate.id);

                    if (session === undefined || working(session, now.sessions)) {
                        return;
                    }

                    // Subagents finish inside their parent's run; only the parent's end is worth a sound.
                    if (session.parent === undefined) {
                        chime();
                    }

                    if (session.id !== now.current) {
                        showSessionAlert(
                            {
                                id: `finished-${String(session.id)}`,
                                level: "success",
                                session: session.id,
                                title: session.title ?? "New session",
                                description: `Finished · ${folderName(session.cwd)}`,
                            },
                            now.onOpen,
                        );
                    }
                }, SETTLE_MS),
            );
        }

        before.current = sessions;
    }, [sessions, current, onOpen]);

    useEffect(() => {
        const pending = timers.current;

        return () => {
            for (const timer of pending.values()) {
                clearTimeout(timer);
            }

            pending.clear();
        };
    }, []);
}
