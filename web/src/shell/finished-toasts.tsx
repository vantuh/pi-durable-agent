import { useEffect, useEffectEvent, useRef } from "react";

import type { SessionSummary } from "../../../shared/protocol.ts";
import { finishedBetween } from "../lib/finished.ts";
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

/**
 * A toast when another session's run ends; a click anywhere on it opens that session. A chime when
 * any run ends, the one on screen included.
 */
export function useFinishedToasts(
    sessions: SessionSummary[],
    current: number | null,
    onOpen: (id: number) => void,
): void {
    const before = useRef<SessionSummary[]>([]);
    const announce = useEffectEvent((after: SessionSummary[]) => {
        // Subagents finish inside their parent's run; only the parent's end is worth a sound.
        if (finishedBetween(before.current, after, null).some((row) => row.parent === undefined)) {
            chime();
        }

        for (const session of finishedBetween(before.current, after, current)) {
            showSessionAlert(
                {
                    id: `finished-${String(session.id)}`,
                    level: "success",
                    session: session.id,
                    title: session.title ?? "New session",
                    description: `Finished · ${folderName(session.cwd)}`,
                },
                onOpen,
            );
        }

        before.current = after;
    });

    useEffect(() => {
        announce(sessions);
    }, [sessions]);
}
