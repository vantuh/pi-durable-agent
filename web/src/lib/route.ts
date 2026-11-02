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

/** The app's own history entry: the route it shows, an id of its own, and the id of the step behind it. */
export type Entry = { route: Route; id: string; from?: string };

function historyEntry(): Entry | undefined {
    const state: unknown = history.state;

    if (typeof state !== "object" || state === null) {
        return undefined;
    }

    const pi: unknown = Reflect.get(state, "pi");

    if (typeof pi !== "object" || pi === null) {
        return undefined;
    }

    const route: unknown = Reflect.get(pi, "route");
    const id: unknown = Reflect.get(pi, "id");
    const from: unknown = Reflect.get(pi, "from");

    if (!isRoute(route) || typeof id !== "string") {
        return undefined;
    }

    return typeof from === "string" ? { route, id, from } : { route, id };
}

const ENTRIES = "pi.route.entries";
// A step back is worth more than the oldest ids: past this, an arrow replaces instead of going back.
const ENTRIES_KEPT = 200;
// A record that cannot be written is a record that would answer with what an entry used to show.
let unsaved = false;

/** The route each entry shows now, by id: replaced since it was pushed, it no longer answers its children. */
function entryRoutes(): Map<string, Route> {
    const routes = new Map<string, Route>();

    if (unsaved) {
        return routes;
    }

    try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(ENTRIES) ?? "{}");

        if (typeof stored === "object" && stored !== null) {
            for (const [id, route] of Object.entries(stored)) {
                if (isRoute(route)) {
                    routes.set(id, route);
                }
            }
        }
    } catch {
        return routes;
    }

    return routes;
}

function rememberRoute(id: string, route: Route): void {
    const routes = entryRoutes();

    routes.delete(id);
    routes.set(id, route);

    const ids = [...routes.keys()];

    for (const stale of ids.slice(0, Math.max(0, ids.length - ENTRIES_KEPT))) {
        routes.delete(stale);
    }

    try {
        sessionStorage.setItem(ENTRIES, JSON.stringify(Object.fromEntries(routes)));
    } catch {
        // What is stored is now behind the truth, and an arrow reading it would step into the wrong
        // entry: trust nothing for the rest of the page's life, and leave nothing for a reload either.
        unsaved = true;

        try {
            sessionStorage.removeItem(ENTRIES);
        } catch {
            // A storage that refuses both leaves only the flag above.
        }
    }
}

/**
 * Whether the parent arrow may step back: the entry behind this one is still the parent. `there` is the
 * route the record says that entry shows now, which stops matching once it has been replaced.
 */
export function stepsBack(
    entry: Entry | undefined,
    there: Route | undefined,
    parent: Route,
): boolean {
    return entry?.from !== undefined && there !== undefined && sameRoute(there, parent);
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
        const entry = historyEntry();

        if (entry === undefined) {
            const id = crypto.randomUUID();

            history.replaceState({ pi: { route: current.current, id } }, "");
            rememberRoute(id, current.current);
        } else {
            rememberRoute(entry.id, entry.route);
        }

        const back = (): void => {
            const next = routeFromSearch(location.search);
            const before = current.current;
            const here = historyEntry();

            current.current = next;
            setRoute(next);

            // A traversal only moves between entries the app wrote, so its id and marker stay as pushed.
            if (here !== undefined) {
                rememberRoute(here.id, next);
            }

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

            const id = crypto.randomUUID();
            const behind = historyEntry()?.id;
            const entry: Entry =
                behind === undefined ? { route: next, id } : { route: next, id, from: behind };

            history.pushState({ pi: entry }, "", href);
            rememberRoute(id, next);
            current.current = next;
            setRoute(next);
            countOpening(before, next);
        },
        [countOpening],
    );

    const replace = useCallback(
        (next: Route) => {
            const before = current.current;
            // The entry keeps its id, so a child still names it; the record shows it is no longer that
            // route, which is what stops the child's marker from being trusted. It forgets its own way back.
            const id = historyEntry()?.id ?? crypto.randomUUID();

            history.replaceState({ pi: { route: next, id } }, "", routeHref(next));
            rememberRoute(id, next);
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

            const entry = historyEntry();
            // A deep link has no entry behind it, and one replaced since no longer shows the parent: both
            // replace this step instead of stepping back into something else.
            const there = entry?.from === undefined ? undefined : entryRoutes().get(entry.from);

            if (stepsBack(entry, there, next)) {
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
