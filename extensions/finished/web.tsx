import { useEffect, useRef } from "react";

import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";
import { showSessionAlert } from "@/shell/session-alert.tsx";
import { folderName } from "@/shell/session-parts.tsx";

import type { SessionSummary } from "../../shared/protocol.ts";
import { finishedBetween, working } from "./finished.ts";

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
 * A toast when another top-level session stops working; a click anywhere on it opens that session. A
 * chime when one does, the one on screen included. Subagents give neither. A session works while its own run or any
 * subagent below it does, and the signal comes only once it has stayed idle for a moment. It draws nothing: the
 * status bar only keeps it mounted.
 */
function Finished({ session, sessions, openSession }: StatusItemProps) {
    const current = session?.id ?? null;
    const before = useRef<SessionSummary[]>([]);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    const latest = useRef({ sessions, current, openSession });

    useEffect(() => {
        latest.current = { sessions, current, openSession };

        // A session that works again waits its full time after the next finish.
        for (const [id, timer] of timers.current) {
            const row = sessions.find((each) => each.id === id);

            if (row !== undefined && working(row, sessions)) {
                clearTimeout(timer);
                timers.current.delete(id);
            }
        }

        for (const candidate of finishedBetween(before.current, sessions, null)) {
            if (timers.current.has(candidate.id)) {
                continue;
            }

            timers.current.set(
                candidate.id,
                setTimeout(() => {
                    timers.current.delete(candidate.id);

                    const now = latest.current;
                    const ended = now.sessions.find((row) => row.id === candidate.id);

                    // Subagents finish inside their parent's run; only the parent's end is worth a signal.
                    if (
                        ended === undefined ||
                        ended.parent !== undefined ||
                        working(ended, now.sessions)
                    ) {
                        return;
                    }

                    chime();

                    if (ended.id !== now.current) {
                        showSessionAlert(
                            {
                                id: `finished-${String(ended.id)}`,
                                level: "success",
                                session: ended.id,
                                title: ended.title ?? "New session",
                                description: `Finished · ${folderName(ended.cwd)}`,
                            },
                            now.openSession,
                        );
                    }
                }, SETTLE_MS),
            );
        }

        before.current = sessions;
    }, [sessions, current, openSession]);

    useEffect(() => {
        const pending = timers.current;

        return () => {
            for (const timer of pending.values()) {
                clearTimeout(timer);
            }

            pending.clear();
        };
    }, []);

    return null;
}

export default {
    status: [{ id: "finished", slot: "start", component: Finished }],
} satisfies WebExtension;
