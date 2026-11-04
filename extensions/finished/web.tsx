import { useEffect, useEffectEvent, useRef } from "react";

import type { StatusItemProps, WebExtension } from "@/sdk/types.ts";
import { showSessionAlert } from "@/shell/session-alert.tsx";
import { folderName } from "@/shell/session-parts.tsx";

import type { SessionSummary } from "../../shared/protocol.ts";
import { finishedBetween } from "./finished.ts";

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
 * any run ends, the one on screen included. It draws nothing: the status bar only keeps it mounted.
 */
function Finished({ session, sessions, openSession }: StatusItemProps) {
    const current = session?.id ?? null;
    const before = useRef<SessionSummary[]>([]);
    const announce = useEffectEvent((after: SessionSummary[]) => {
        // Subagents finish inside their parent's run; only the parent's end is worth a sound.
        if (finishedBetween(before.current, after, null).some((row) => row.parent === undefined)) {
            chime();
        }

        for (const ended of finishedBetween(before.current, after, current)) {
            showSessionAlert(
                {
                    id: `finished-${String(ended.id)}`,
                    level: "success",
                    session: ended.id,
                    title: ended.title ?? "New session",
                    description: `Finished · ${folderName(ended.cwd)}`,
                },
                openSession,
            );
        }

        before.current = after;
    });

    useEffect(() => {
        announce(sessions);
    }, [sessions]);

    return null;
}

export default {
    status: [{ id: "finished", slot: "start", component: Finished }],
} satisfies WebExtension;
