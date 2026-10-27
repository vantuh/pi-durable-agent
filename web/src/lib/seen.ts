import { useEffect, useEffectEvent, useState } from "react";

import { markSeen } from "./api.ts";

/** Visible alone is not enough: a tab left in sight on a computer nobody sits at would mark the phone's work. */
function attentive(): boolean {
    return document.visibilityState === "visible" && document.hasFocus();
}

/** Marks the session on screen as seen on the server, whenever it is unseen while someone is looking. */
export function useSeen(
    session: number | null,
    unseen: boolean,
    onSeen: (session: number) => void,
): void {
    const [looking, setLooking] = useState(attentive);
    const seen = useEffectEvent(onSeen);

    useEffect(() => {
        const change = (): void => {
            setLooking(attentive());
        };

        window.addEventListener("focus", change);
        window.addEventListener("blur", change);
        document.addEventListener("visibilitychange", change);

        return () => {
            window.removeEventListener("focus", change);
            window.removeEventListener("blur", change);
            document.removeEventListener("visibilitychange", change);
        };
    }, []);

    useEffect(() => {
        if (session === null || !unseen || !looking) {
            return;
        }

        void (async () => {
            await markSeen(session);
            seen(session);
        })();
    }, [session, unseen, looking]);
}
