import { useCallback, useEffect, useState } from "react";

import { type Route, routeFromSearch, routeHref } from "./deep-link.ts";

/** `/` is home, `?session=N` is a session: the links pushes already send. */
export function sessionHref(session: number | null): string {
    return session === null ? "/" : `/?session=${String(session)}`;
}

export type RouteNavigation = {
    /** The session the address names, and the extension page it shows instead of the conversation. */
    route: Route;
    /** Opens a session's conversation; any page open on the way is left. */
    go: (session: number | null) => void;
    /** Opens an extension's page in the open session. */
    openPage: (key: string) => void;
    /** Moves the open page to one of its own sub-locations, adding a history step. */
    setPageSub: (sub: string | undefined) => void;
    /** Back to the conversation; the page is left. */
    closePage: () => void;
};

/** The address is the state: every move pushes a history step, so Back returns. */
export function useRoute(): RouteNavigation {
    const [route, setRoute] = useState(() => routeFromSearch(location.search));

    useEffect(() => {
        const back = (): void => {
            setRoute(routeFromSearch(location.search));
        };

        window.addEventListener("popstate", back);

        return () => {
            window.removeEventListener("popstate", back);
        };
    }, []);

    const show = useCallback((next: Route) => {
        const href = routeHref(next);

        if (href !== location.pathname + location.search) {
            history.pushState(null, "", href);
        }

        setRoute(next);
    }, []);

    const session = route.session;
    const page = route.page?.key ?? null;

    const go = useCallback(
        (next: number | null) => {
            show({ session: next, page: null });
        },
        [show],
    );
    const openPage = useCallback(
        (key: string) => {
            if (session !== null) {
                show({ session, page: { key, sub: undefined } });
            }
        },
        [session, show],
    );
    const setPageSub = useCallback(
        (sub: string | undefined) => {
            if (session !== null && page !== null) {
                show({ session, page: { key: page, sub } });
            }
        },
        [session, page, show],
    );
    const closePage = useCallback(() => {
        if (session !== null) {
            show({ session, page: null });
        }
    }, [session, show]);

    return { route, go, openPage, setPageSub, closePage };
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
