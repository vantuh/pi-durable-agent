import { useCallback, useEffect, useRef, useState } from "react";

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
    /** The parent of the page's current sub-location; the page root's parent is the conversation. */
    backPage: (parent: string | undefined) => void;
    /** Back to the conversation; the page is left. */
    closePage: () => void;
    /** Leaves a page nothing answers, in this history step rather than a new one. */
    dropPage: () => void;
};

const sameRoute = (left: Route, right: Route): boolean =>
    left.session === right.session &&
    left.page?.key === right.page?.key &&
    left.page?.sub === right.page?.sub;

/**
 * Whether a move ends the page instance on screen: another page, another session, or no page at all.
 * Moving to another sub-location of the same page keeps it, and with it the handles it holds.
 */
export function endsPage(before: Route, after: Route): boolean {
    return before.session !== after.session || before.page?.key !== after.page?.key;
}

function isRoute(value: unknown): value is Route {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const session = Reflect.get(value, "session");
    const page: unknown = Reflect.get(value, "page");

    if (session !== null && typeof session !== "number") {
        return false;
    }

    if (page === null) {
        return true;
    }

    if (typeof page !== "object" || page === null) {
        return false;
    }

    const key = Reflect.get(page, "key");
    const sub = Reflect.get(page, "sub");

    return typeof key === "string" && (sub === undefined || typeof sub === "string");
}

/** The app's own history entry: the route it shows, and the route it was pushed from. */
function historyEntry(): { route: Route; from?: Route } | undefined {
    const state: unknown = history.state;

    if (typeof state !== "object" || state === null) {
        return undefined;
    }

    const pi: unknown = Reflect.get(state, "pi");

    if (typeof pi !== "object" || pi === null) {
        return undefined;
    }

    const route: unknown = Reflect.get(pi, "route");
    const from: unknown = Reflect.get(pi, "from");

    if (!isRoute(route)) {
        return undefined;
    }

    return isRoute(from) ? { route, from } : { route };
}

/** The address is the state: every move pushes a history step, so Back returns. */
export function useRoute(): RouteNavigation {
    const [route, setRoute] = useState(() => routeFromSearch(location.search));
    // Every move below writes this before it re-renders; the first render starts it at the address.
    const current = useRef(route);
    // A page's `navigate` and `close` belong to the opening that made them. The counter moves on when
    // that page leaves, so an answer arriving from a page instance that has gone cannot move the new one.
    const [opening, setOpening] = useState(0);
    const live = useRef(0);

    /** Bumps the opening when a move ends the page on screen, which retires the handles it captured. */
    const countOpening = useCallback((before: Route, after: Route) => {
        if (endsPage(before, after)) {
            live.current += 1;
            setOpening(live.current);
        }
    }, []);

    useEffect(() => {
        // The first entry has no marker yet: it remembers the route it was loaded with, so a deep
        // link's close replaces it instead of stepping back out of the app.
        if (historyEntry() === undefined) {
            history.replaceState({ pi: { route: current.current } }, "");
        }

        const back = (): void => {
            const next = routeFromSearch(location.search);
            const before = current.current;
            current.current = next;
            setRoute(next);
            // The entry's `from` belonged to the push that made it; a traversal may have skipped
            // that entry, so this one no longer knows its neighbour.
            history.replaceState({ pi: { route: next } }, "");
            countOpening(before, next);
        };

        window.addEventListener("popstate", back);

        return () => {
            window.removeEventListener("popstate", back);
        };
    }, [countOpening]);

    const show = useCallback(
        (next: Route) => {
            const before = current.current;
            const href = routeHref(next);
            const here = location.pathname + location.search;

            if (href === here) {
                current.current = next;
                setRoute(next);
                return;
            }

            history.pushState({ pi: { route: next, from: before } }, "", href);
            current.current = next;
            setRoute(next);
            countOpening(before, next);
        },
        [countOpening],
    );

    const replace = useCallback(
        (next: Route) => {
            const before = current.current;

            history.replaceState({ pi: { route: next } }, "", routeHref(next));
            current.current = next;
            setRoute(next);
            countOpening(before, next);
        },
        [countOpening],
    );

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
            // The handle belongs to the opening that made it: a page that has left and been opened
            // again is a new one, and only its own navigation applies.
            if (opening !== live.current || page === null) {
                return;
            }

            show({ session, page: { key: page, sub } });
        },
        [opening, session, page, show],
    );
    const backPage = useCallback(
        (parent: string | undefined) => {
            const now = current.current;

            if (now.session === null || now.page === null) {
                return;
            }

            const next: Route = {
                session: now.session,
                page: { key: now.page.key, sub: parent },
            };
            const previous = historyEntry()?.from;

            // Back only if the entry behind this one is the parent we are going to. A deep link
            // has no such entry, so it replaces its own step instead of leaving the app.
            if (previous !== undefined && sameRoute(previous, next)) {
                history.back();
                return;
            }

            replace(next);
        },
        [replace],
    );
    const closePage = useCallback(() => {
        // The same opening rule as `setPageSub`: a close from a page that has already been left.
        if (opening !== live.current || page === null) {
            return;
        }

        show({ session, page: null });
    }, [opening, session, page, show]);

    const dropPage = useCallback(() => {
        const now = current.current;

        if (now.page === null) {
            return;
        }

        replace({ session: now.session, page: null });
    }, [replace]);

    return { route, go, openPage, setPageSub, backPage, closePage, dropPage };
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
