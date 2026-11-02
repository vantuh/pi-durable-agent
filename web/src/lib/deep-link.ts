/** The session a `?session=<id>` link names, or undefined when the value is not a positive integer. */
export function sessionFromSearch(search: string): number | undefined {
    const value = new URLSearchParams(search).get("session");

    if (value === null || !/^[1-9]\d*$/.test(value)) {
        return undefined;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) ? id : undefined;
}

/** An extension's page in the address: its key (`<folder>:<id>`) and the page's own sub-location. */
export type PageRoute = { key: string; sub: string | undefined };

/** The address as the app reads it: the session, and the page shown in place of its conversation. */
export type Route = { session: number | null; page: PageRoute | null };

/** The address of a route: a session alone, or the session with a page open at some place in it. */
export function routeHref(route: Route): string {
    if (route.session === null) {
        return "/";
    }

    const params = new URLSearchParams({ session: String(route.session) });

    if (route.page !== null) {
        params.set("page", route.page.key);

        if (route.page.sub !== undefined) {
            params.set("sub", route.page.sub);
        }
    }

    return `/?${params.toString()}`;
}

/**
 * The route a search string names. A page without a session is no page: a page is reached inside a
 * conversation only. An empty `page` or `sub` is absent.
 */
export function routeFromSearch(search: string): Route {
    const session = sessionFromSearch(search) ?? null;
    const params = new URLSearchParams(search);
    const key = params.get("page");

    if (session === null || key === null || key === "") {
        return { session, page: null };
    }

    const sub = params.get("sub");

    return { session, page: { key, sub: sub === null || sub === "" ? undefined : sub } };
}
