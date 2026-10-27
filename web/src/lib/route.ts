import { useCallback, useEffect, useState } from "react";

import { sessionFromSearch } from "./deep-link.ts";

/** `/` is home, `?session=N` is a session: the only two places, and the links pushes already send. */
export function sessionHref(session: number | null): string {
    return session === null ? "/" : `/?session=${String(session)}`;
}

/** The session the address names, null on home; going somewhere adds a history step, so Back returns. */
export function useRoute(): [number | null, (session: number | null) => void] {
    const [session, setSession] = useState(() => sessionFromSearch(location.search) ?? null);

    useEffect(() => {
        const back = (): void => {
            setSession(sessionFromSearch(location.search) ?? null);
        };

        window.addEventListener("popstate", back);

        return () => {
            window.removeEventListener("popstate", back);
        };
    }, []);

    const go = useCallback((next: number | null) => {
        if (sessionHref(next) !== location.pathname + location.search) {
            history.pushState(null, "", sessionHref(next));
        }

        setSession(next);
    }, []);

    return [session, go];
}

/** A plain click goes in the app; a modified or middle click is the browser's, so a new tab opens. */
export function isPlainClick(event: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}): boolean {
    return (
        event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    );
}
